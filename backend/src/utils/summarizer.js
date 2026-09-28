import crypto from 'crypto';
import path from 'path';
import { config, paths } from '../config/env.js';
import { logger, secs, timer, watchdog } from './logger.js';
import { writeJsonAtomic, readJson } from './atomicFile.js';
import { countWords } from './textCleaner.js';
import { splitSentences } from './sentences.js';
import { paragraph } from './narrator.js';
import { INTRO_CLOSER, summaryIntroOpening, summaryOutroOpening } from './narrationMarkers.js';
import { INTRO_CAPS } from './summaryPlan.js';
import { indexText, checkSection, describeIssue } from './summaryCheck.js';
import { callJson } from './llm/index.js';
import { llmError, cancelled } from './llm/errors.js';

/**
 * Writes a summary from a plan (summaryPlan.js) with one of the providers in
 * llm/. Every passage is summarized from its full text, checked on this machine
 * against that text (summaryCheck.js), corrected once if the check fails, held
 * to its word budget, and cached, so a cancel, a crash or a rate limit costs
 * only the passage that was in flight.
 *
 * Bump PROMPT_VERSION whenever a prompt or the post-processing changes what a
 * passage would come out as. It is part of every cache key, so old answers are
 * simply never read again.
 */
const PROMPT_VERSION = 1;

const SECTIONS_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          paragraphs: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'paragraphs'],
        additionalProperties: false,
      },
    },
  },
  required: ['sections'],
  additionalProperties: false,
};

const PARAGRAPHS_SCHEMA = {
  type: 'object',
  properties: { paragraphs: { type: 'array', items: { type: 'string' } } },
  required: ['paragraphs'],
  additionalProperties: false,
};

const INTRO_SCHEMA = {
  type: 'object',
  properties: {
    about: { type: 'string' },
    invitation: { type: 'string' },
    reflection: { type: 'string' },
    farewell: { type: 'string' },
  },
  required: ['about', 'invitation', 'reflection', 'farewell'],
  additionalProperties: false,
};

const SYSTEM = [
  'You write spoken book summaries for an audiobook channel. A narrator voice reads your words',
  'aloud, so write for the ear.',
  '',
  'Accuracy comes first:',
  '- Use only what the passage you are given states. Do not add facts, names, dates, figures,',
  '  examples, stories or quotations that are not in it, and do not draw on anything you know',
  '  about this book or its author from elsewhere.',
  '- Where the book argues a position, present it as the author\'s view (by name when the author',
  '  is given), not as settled fact.',
  '- Follow the passage\'s own order and emphasis. Spend words where the passage spends them, and',
  '  keep the central example or story a point depends on.',
  '- Quote sparingly: at most one short quotation per passage, copied word for word from the',
  '  passage inside double quotation marks. Never put quotation marks around a paraphrase.',
  '- Keep every name and number exactly as the passage gives it.',
  '',
  'Form:',
  '- Flowing prose paragraphs of three to six sentences. No headings, lists, bullet points,',
  '  markdown, emphasis, parentheses, abbreviations, emojis or stage directions.',
  '- Present tense. Plain, warm, precise language.',
  '- Never open with "In this chapter" or "This section", and never mention chapter or page numbers.',
].join('\n');

let running = false;

function isBusy() {
  return running;
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function words(list) {
  return countWords(list.join(' '));
}

/**
 * One piece of model prose as one narratable paragraph: stray markdown and list
 * markers removed, whitespace flattened (a newline inside a paragraph would be
 * read as a paragraph break), and terminal punctuation forced so the narration
 * pipeline ends the sentence there. Unlike narrator.paragraph, a closing quote
 * mark is left alone: a summary paragraph can end on a quotation.
 */
function flatten(text) {
  const out = String(text || '')
    .replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, '')
    .replace(/[*_#`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!out || !/[A-Za-z]/.test(out)) return '';
  return /[.!?]["”’)]*$/.test(out) ? out : `${out}.`;
}

function cleanParagraphs(list) {
  return (Array.isArray(list) ? list : [])
    .flatMap((entry) => String(entry || '').split(/\n\s*\n/))
    .map(flatten)
    .filter(Boolean);
}

/**
 * Drops whole sentences from the end until the paragraphs fit. The last resort
 * after the model has been asked to shorten its own text and still ran long;
 * it is what makes "never longer than the budget" a guarantee rather than a hope.
 */
function trimToBudget(paragraphs, budget) {
  const out = paragraphs.map((p) => splitSentences(p));
  const count = () => out.reduce((sum, sentences) => sum + countWords(sentences.join(' ')), 0);
  while (out.length && count() > budget) {
    const last = out[out.length - 1];
    if (out.length === 1 && last.length === 1) break;
    last.pop();
    if (!last.length) out.pop();
  }
  return out.map((sentences) => sentences.join(' ')).filter(Boolean);
}

function label(item) {
  const name = item.context?.length ? item.context.join(' / ') : 'The opening';
  return item.parts > 1 ? `${name} (part ${item.part + 1} of ${item.parts})` : name;
}

// --- prompts ------------------------------------------------------------------

function bookLines(ctx) {
  return [
    `Book: ${ctx.meta.title}`,
    ctx.meta.author ? `Author: ${ctx.meta.author}` : 'Author: not stated. Do not name one.',
    ctx.chapterTitles.length
      ? `The book's sections, for orientation only: ${ctx.chapterTitles.slice(0, 60).join(' | ')}`
      : '',
  ].filter(Boolean);
}

function passageBlock(item) {
  const aim = Math.max(30, Math.round(item.budget * 0.9));
  return [
    `[id ${item.id}] ${label(item)} - about ${aim} words, never more than ${item.budget}`,
    '"""',
    item.source,
    '"""',
  ].join('\n');
}

function unitPrompt(items, ctx, { tail = '', noQuotes = false, feedback = null, previous = '' } = {}) {
  const lines = [...bookLines(ctx), ''];

  if (ctx.structure === 'continuous') {
    lines.push(
      'This summary is one continuous talk that moves through the book in order, with no headings.',
      'Do not name chapters or announce where one ends. Carry each passage on from the one before',
      'with a natural spoken transition.',
    );
    lines.push(
      tail
        ? `The talk so far ends like this. Continue from it without repeating it:\n"""\n${tail}\n"""`
        : "These passages open the talk, straight after the introduction. Begin with the book's first idea, not with a greeting or a preview.",
    );
  } else {
    lines.push(
      'Each passage is summarized on its own and read under its own heading, which is added',
      'separately. Do not repeat the heading.',
    );
  }

  lines.push(
    '',
    items.length === 1
      ? 'Summarize the passage below. Return it as one entry with its id.'
      : `Summarize each of the ${items.length} passages below separately. Return one entry per passage with its id.`,
    'Each passage shows a word count: aim for it, and never go over the maximum.',
  );
  if (noQuotes) lines.push('Do not quote the book at all in this answer. Paraphrase everything.');

  if (feedback) {
    lines.push(
      '',
      'Your previous summary of this passage had these problems:',
      ...feedback.map((line) => `- ${line}`),
      'Write it again so that every problem is gone. Quote only words that appear exactly in the',
      'passage, or paraphrase without quotation marks. Use only names and figures the passage itself',
      'contains.',
      'Your previous summary:',
      '"""',
      previous,
      '"""',
    );
  }

  lines.push('', ...items.map(passageBlock));
  return lines.join('\n');
}

function shortenPrompt(item, paragraphs, ctx) {
  const aim = Math.max(30, Math.round(item.budget * 0.9));
  return [
    ...bookLines(ctx),
    '',
    `Below is a spoken summary you wrote of one passage of this book. It is ${words(paragraphs)} words.`,
    `Rewrite it in at most ${item.budget} words, aiming for about ${aim}.`,
    'Keep the most important points, and keep every fact, name and quotation exactly as it stands.',
    'Add nothing new. Same form: flowing spoken paragraphs.',
    '"""',
    paragraphs.join('\n\n'),
    '"""',
  ].join('\n');
}

function introPrompt(ctx, summaryText) {
  return [
    ...bookLines(ctx),
    '',
    'You are writing what a narrator says either side of a spoken SUMMARY of this book: a short',
    'introduction before it and closing words after it. It is read aloud, so write for the ear.',
    '',
    'Return four pieces of prose. Each is ONE paragraph of plain sentences: no headings, lists,',
    'markdown, stage directions, line breaks, or quotation marks around the whole thing.',
    `- about (${INTRO_CAPS.about - 30} to ${INTRO_CAPS.about} words): what the book is about and what this summary walks`,
    '  the listener through. Name the actual subject matter.',
    `- invitation (30 to ${INTRO_CAPS.invitation} words): how to listen, ending on what the listener stands to take away.`,
    `- reflection (${INTRO_CAPS.reflection - 40} to ${INTRO_CAPS.reflection} words): the closing thought. The two or three`,
    '  central ideas the summary covered, as the summary states them.',
    `- farewell (15 to ${INTRO_CAPS.farewell} words): two short sentences handing over. Warm and final. It may suggest`,
    '  the full book for the depth a summary leaves out.',
    '',
    'Use only what the summary below says. Do not state how long the summary is.',
    'Do NOT write a welcome line, a title, an author credit, "let us begin", or a "that brings us to',
    'the end" line. Those are added around your text already.',
    '',
    'THE SUMMARY:',
    '"""',
    summaryText,
    '"""',
  ].join('\n');
}

// --- cache --------------------------------------------------------------------

function cachePath(key) {
  return path.join(paths.summaries, `${key}.json`);
}

function unitKey(ctx, unit, tail) {
  return sha1(
    JSON.stringify([
      PROMPT_VERSION,
      ctx.provider.id,
      ctx.model,
      ctx.structure,
      ctx.meta.title,
      ctx.meta.author,
      unit.items.map((item) => [item.context, item.titles, item.part, item.parts, item.budget, sha1(item.source)]),
      ctx.structure === 'continuous' ? tail : '',
    ]),
  );
}

function readUnit(key, unit) {
  const cached = readJson(cachePath(key));
  if (!cached || cached.v !== PROMPT_VERSION || !Array.isArray(cached.items)) return null;
  return cached.items.length === unit.items.length ? cached : null;
}

function lastParagraph(result) {
  const items = result?.items || [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const paras = items[i].paragraphs || [];
    if (paras.length) return paras[paras.length - 1];
  }
  return '';
}

/** How many units a run would take from the cache: the page's "12 of 40 done". */
function countCached(plan, resolved) {
  const ctx = { provider: resolved.provider, model: resolved.model, structure: plan.structure, meta: plan.meta };
  let tail = '';
  let hits = 0;
  for (const unit of plan.units) {
    const hit = readUnit(unitKey(ctx, unit, tail), unit);
    if (hit) hits += 1;
    if (plan.structure === 'continuous') {
      // Each unit's key includes the text before it, so the chain stops at the
      // first unit that has not been written.
      if (!hit) break;
      tail = lastParagraph(hit) || tail;
    }
  }
  return hits;
}

// --- one passage ----------------------------------------------------------------

async function ask(ctx, prompt, schema) {
  ctx.calls += 1;
  return callJson(ctx.resolved, { system: SYSTEM, prompt, schema }, {
    signal: ctx.signal,
    onWait: (wait) => ctx.emit({ type: 'wait', ...wait }),
  });
}

/** Asks again but keeps what it had if the retry itself fails. Never swallows a cancel. */
async function attempt(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error.code === 'CANCELLED') throw error;
    logger.warn('summary', `a follow-up request failed; keeping the first answer (${error.message})`);
    return null;
  }
}

function sectionsFrom(parsed) {
  const map = new Map();
  for (const entry of parsed?.sections || []) {
    const id = String(entry?.id ?? '').replace(/\D/g, '') || String(entry?.id ?? '');
    map.set(id, entry?.paragraphs);
  }
  return map;
}

async function askItems(items, ctx, options) {
  return ask(ctx, unitPrompt(items, ctx, options), SECTIONS_SCHEMA);
}

/**
 * Check, correct once, then hold to budget. Returns the paragraphs and whatever
 * the checks still found, which the page shows as warnings.
 */
async function finishItem(item, paragraphs, ctx, tail) {
  const source = indexText(item.source);
  const check = (paras) => checkSection(paras.join(' '), source, ctx.book, ctx.allowed);

  let issues = check(paragraphs);
  if (issues.length) {
    ctx.emit({ type: 'check', title: label(item), issues: issues.length });
    const retry = await attempt(() =>
      askItems([item], ctx, {
        tail,
        feedback: issues.map(describeIssue),
        previous: paragraphs.join('\n\n'),
      }),
    );
    const fixed = cleanParagraphs(retry?.sections?.[0]?.paragraphs);
    if (fixed.length) {
      const fixedIssues = check(fixed);
      if (fixedIssues.length <= issues.length) {
        paragraphs = fixed;
        issues = fixedIssues;
      }
    }
  }

  if (words(paragraphs) > item.budget) {
    const shorter = await attempt(() => ask(ctx, shortenPrompt(item, paragraphs, ctx), PARAGRAPHS_SCHEMA));
    const cleaned = cleanParagraphs(shorter?.paragraphs);
    if (cleaned.length && words(cleaned) < words(paragraphs) && check(cleaned).length <= issues.length) {
      paragraphs = cleaned;
      issues = check(cleaned);
    }
    paragraphs = trimToBudget(paragraphs, item.budget);
    const kept = paragraphs.join(' ');
    issues = issues.filter((issue) => kept.includes(issue.sentence));
  }

  return { paragraphs, issues };
}

/** One request (a batch of passages), then each passage finished on its own. */
async function runUnit(unit, ctx, tail) {
  let parsed;
  try {
    parsed = await askItems(unit.items, ctx, { tail });
  } catch (error) {
    if (error.code !== 'LLM_BLOCKED') throw error;
    // Usually Gemini's RECITATION: a quotation it will not reproduce. Once more
    // without any quoting at all.
    parsed = await attempt(() => askItems(unit.items, ctx, { tail, noQuotes: true }));
  }

  const answers = sectionsFrom(parsed);
  const items = [];
  let runningTail = tail;
  for (const item of unit.items) {
    let paragraphs = cleanParagraphs(
      answers.get(item.id) ?? (unit.items.length === 1 ? parsed?.sections?.[0]?.paragraphs : undefined),
    );

    // A passage missing from a batched answer is asked for on its own.
    if (!paragraphs.length && parsed) {
      const single = await attempt(() => askItems([item], ctx, { tail: runningTail }));
      paragraphs = cleanParagraphs(single?.sections?.[0]?.paragraphs);
    }

    if (!paragraphs.length) {
      items.push({
        paragraphs: [],
        issues: [],
        missing: `${ctx.provider.label} did not summarize this part, so it is missing from the summary.`,
      });
      continue;
    }

    const finished = await finishItem(item, paragraphs, ctx, runningTail);
    items.push(finished);
    runningTail = finished.paragraphs[finished.paragraphs.length - 1] || runningTail;
  }

  return { v: PROMPT_VERSION, items };
}

async function pool(units, limit, worker, signal) {
  let next = 0;
  let failure = null;
  const lane = async () => {
    while (!failure && !signal?.aborted && next < units.length) {
      const unit = units[next];
      next += 1;
      try {
        await worker(unit);
      } catch (error) {
        failure = failure || error;
      }
    }
  };
  // In-flight requests finish (and are cached) after a failure; no new one starts.
  await Promise.all(Array.from({ length: Math.min(limit, units.length) }, lane));
  if (signal?.aborted) throw cancelled();
  if (failure) throw failure;
}

// --- intro and outro -------------------------------------------------------------

function templateNarration(meta) {
  const by = meta.author ? `, in the order ${meta.author} lays them out` : ', in the order the book lays them out';
  return {
    about:
      `This summary walks through the central ideas of ${meta.title}${by}. It keeps the arguments and ` +
      'the examples they rest on, and leaves out the detail that only the full book can give.',
    invitation: 'Take it at an easy pace, and let each idea settle before the next one arrives.',
    reflection:
      'A summary can only carry the outline of a book. What matters now is which of these ideas you ' +
      'find yourself returning to.',
    farewell: 'If one of them stayed with you, the full book is where it is argued at length. Thank you for listening.',
  };
}

async function writeNarration(ctx, bodyText, firstParagraphs) {
  const source =
    countWords(bodyText) <= ctx.resolved.limits.maxInputWords ? bodyText : firstParagraphs.join('\n\n');
  const key = sha1(
    JSON.stringify([PROMPT_VERSION, 'intro', ctx.provider.id, ctx.model, ctx.structure, ctx.meta, sha1(source)]),
  );

  const cached = !ctx.fresh && readJson(cachePath(key));
  if (cached?.v === PROMPT_VERSION && cached.pieces) return { pieces: cached.pieces, source: 'ai', reason: null };

  let parsed;
  try {
    parsed = await ask(ctx, introPrompt(ctx, source), INTRO_SCHEMA);
  } catch (error) {
    if (error.code === 'CANCELLED') throw error;
    logger.warn('summary', `intro fell back to the template: ${error.message}`);
    return { pieces: templateNarration(ctx.meta), source: 'template', reason: error.message };
  }

  const pieces = {};
  for (const [name, cap] of Object.entries(INTRO_CAPS)) {
    // narrator.paragraph strips quotes wrapped around the whole piece, which is
    // what a model does to a "sentence" it was asked for.
    const piece = trimToBudget([paragraph(parsed?.[name])].filter(Boolean), cap)[0] || '';
    if (!piece) {
      return {
        pieces: templateNarration(ctx.meta),
        source: 'template',
        reason: `${ctx.provider.label} left part of the introduction empty.`,
      };
    }
    pieces[name] = piece;
  }

  writeJsonAtomic(cachePath(key), { v: PROMPT_VERSION, pieces });
  return { pieces, source: 'ai', reason: null };
}

// --- the whole summary -----------------------------------------------------------

/**
 * @param {object} args
 *   plan      from planSummary()
 *   resolved  from llm.resolveProvider(): { provider, model, limits }
 *   fresh     ignore cached answers (they are still overwritten)
 *   signal    aborts in-flight requests: the user pressed Cancel or left the page
 *   emit      progress events for the page
 */
async function summarize({ plan, resolved, fresh = false, signal, emit = () => {} }) {
  if (running) {
    throw llmError('SUMMARY_BUSY', 'A summary is already being written. Wait for it to finish, or cancel it.');
  }
  running = true;

  const elapsed = timer();
  const stopWatchdog = watchdog('summary', `summarizing ${plan.meta.title}`, 60000);
  const ctx = {
    plan,
    resolved,
    provider: resolved.provider,
    model: resolved.model,
    structure: plan.structure,
    meta: plan.meta,
    chapterTitles: plan.chapterTitles,
    allowed: [...plan.chapterTitles, plan.meta.title, plan.meta.author].filter(Boolean),
    book: indexText(plan.body),
    fresh,
    signal,
    emit,
    calls: 0,
  };

  logger.info('summary', 'started', {
    title: plan.meta.title,
    provider: ctx.provider.id,
    model: ctx.model,
    structure: plan.structure,
    target: plan.targetWords,
    units: plan.units.length,
  });

  try {
    const total = plan.units.length;
    const results = new Array(total);
    let done = 0;
    let cachedUnits = 0;

    const runOne = async (unit, tail) => {
      if (signal?.aborted) throw cancelled();
      const titles = [...new Set(unit.items.map(label))];
      emit({ type: 'unit', state: 'start', index: unit.index, done, total, titles });

      const key = unitKey(ctx, unit, tail);
      let result = fresh ? null : readUnit(key, unit);
      const cached = Boolean(result);
      if (!result) {
        result = await runUnit(unit, ctx, tail);
        // A passage the provider refused is not cached, so the next run tries it
        // again instead of inheriting the gap.
        if (!result.items.some((item) => item.missing)) writeJsonAtomic(cachePath(key), result);
      } else cachedUnits += 1;

      results[unit.index] = result;
      done += 1;
      emit({ type: 'unit', state: 'done', index: unit.index, done, total, cached, titles });
      return result;
    };

    if (plan.structure === 'continuous') {
      let tail = '';
      for (const unit of plan.units) {
        const result = await runOne(unit, tail);
        tail = lastParagraph(result) || tail;
      }
    } else {
      await pool(plan.units, resolved.limits.concurrency, (unit) => runOne(unit, ''), signal);
    }

    // Reassemble in reading order: a section's parts, then the next section.
    const bySection = new Map();
    const warnings = [];
    plan.units.forEach((unit, u) => {
      unit.items.forEach((item, k) => {
        const answer = results[u].items[k];
        const list = bySection.get(item.section) || [];
        list.push(...answer.paragraphs);
        bySection.set(item.section, list);
        for (const issue of answer.issues || []) warnings.push({ section: label(item), ...issue });
        if (answer.missing) {
          warnings.push({ section: label(item), kind: 'missing', detail: answer.missing, sentence: '' });
        }
      });
    });

    const blocks = [];
    const firstParagraphs = [];
    const sections = plan.sections.map((section) => {
      const paras = bySection.get(section.index) || [];
      blocks.push(...section.titles, ...paras);
      if (paras.length) firstParagraphs.push(...section.titles, paras[0]);
      return { titles: section.context, budget: section.budget, words: words(paras) };
    });

    emit({ type: 'intro' });
    const bodyText = blocks.join('\n\n');
    const narration = await writeNarration(ctx, bodyText, firstParagraphs);
    const { about, invitation, reflection, farewell } = narration.pieces;

    // The same checks, against the whole book: the intro and outro may only say
    // what the book says too.
    for (const [name, piece] of [['Introduction', `${about} ${invitation}`], ['Closing', `${reflection} ${farewell}`]]) {
      for (const issue of checkSection(piece, ctx.book, ctx.book, ctx.allowed)) warnings.push({ section: name, ...issue });
    }

    const text = `${[
      summaryIntroOpening(ctx.meta.title, ctx.meta.author),
      about,
      invitation,
      INTRO_CLOSER,
      ...blocks,
      summaryOutroOpening(ctx.meta.title, ctx.meta.author),
      reflection,
      farewell,
    ].join('\n\n')}\n`;

    const totalWords = countWords(text);
    if (totalWords > plan.targetWords) {
      // The budgets are built so this cannot happen. If it ever does, it is a
      // bug in the arithmetic, and it should be loud rather than quietly long.
      logger.error('summary', 'summary came out longer than its budget', { words: totalWords, target: plan.targetWords });
    }

    const took = elapsed();
    logger.info('summary', 'finished', {
      title: ctx.meta.title,
      words: totalWords,
      target: plan.targetWords,
      calls: ctx.calls,
      cached: `${cachedUnits}/${total}`,
      warnings: warnings.length,
      took: secs(took),
    });

    return {
      text,
      words: totalWords,
      targetWords: plan.targetWords,
      minutes: plan.minutes,
      speed: plan.speed,
      estimatedMinutes: Math.round((totalWords / (config.summaryWordsPerMinute * plan.speed)) * 10) / 10,
      structure: plan.structure,
      provider: ctx.provider.id,
      providerLabel: ctx.provider.label,
      model: ctx.model,
      title: ctx.meta.title,
      author: ctx.meta.author,
      headings: plan.sections.flatMap((section) => section.titles),
      sections,
      warnings,
      intro: { source: narration.source, reason: narration.reason },
      cachedUnits,
      totalUnits: total,
      calls: ctx.calls,
      seconds: Math.round(took),
    };
  } finally {
    running = false;
    stopWatchdog();
  }
}

export { summarize, isBusy, countCached, PROMPT_VERSION };
