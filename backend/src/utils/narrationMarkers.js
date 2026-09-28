
const INTRO_OPENER = /^welcome to\s/i;

const INTRO_LINE = /^welcome to\s+.+?(?:,\s*written by\s+.+?)?\s*[.!]$/i;

const OUTRO_OPENER = /^that\s+(?:brings\s+us\s+to\s+the\s+end\s+of|concludes)\s/i;

const INTRO_CUE = /^let us begin[.!]?$/i;

const INTRO_CLOSER = 'Let us begin.';

function introOpening(title, author) {
  return author ? `Welcome to ${title}, written by ${author}.` : `Welcome to ${title}.`;
}

function outroOpening(title, author) {
  return author
    ? `That brings us to the end of ${title} by ${author}.`
    : `That brings us to the end of ${title}.`;
}

/**
 * The summary's own opener and closer. Deliberately the same shapes as the two
 * above: "Welcome to this summary of X, written by Y." still matches INTRO_LINE,
 * so findBodyStart keeps it at generation time instead of cutting everything
 * above the first long paragraph, and both still match INTRO_OPENER /
 * OUTRO_OPENER, so stripExistingNarration replaces them on a second pass.
 */
const SUMMARY_PREFIX = /^this summary of\s+/i;

function summaryIntroOpening(title, author) {
  return author
    ? `Welcome to this summary of ${title}, written by ${author}.`
    : `Welcome to this summary of ${title}.`;
}

function summaryOutroOpening(title, author) {
  return author
    ? `That brings us to the end of this summary of ${title} by ${author}.`
    : `That brings us to the end of this summary of ${title}.`;
}

export {
  INTRO_OPENER,
  INTRO_LINE,
  OUTRO_OPENER,
  INTRO_CUE,
  INTRO_CLOSER,
  introOpening,
  outroOpening,
  SUMMARY_PREFIX,
  summaryIntroOpening,
  summaryOutroOpening,
};
