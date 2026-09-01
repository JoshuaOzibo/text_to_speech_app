import fs from 'fs';
import { paths } from '../config/env.js';

const COMMON_WORDS_SOURCE = `
a i
able about above accept according account across act action active actual add
address admit adult affect after again against age ago agree ahead air all allow
almost alone along already also although always among amount an ancient and
animal another answer any anyone anything appear apply approach are area argue
arm around arrange arrangement arrive art article artist as ask aside assume at
attach attachment attack attempt attend attention attitude author authority
available avoid away

baby back bad bag balance ball bank bar base basic battle be bear beat beautiful
because become bed been before begin beginning behavior behind being belief
believe belong below beneath beside best better between beyond big bill billion
bind bird birth bit black block blood blow blue board boat body book born both
bottom box boy brain break bring broad brother budget build building burn
business but buy by

call calm came can cannot capital captain car card care career carry case cash
cast catch cause cell center central century certain certainly chair challenge
chance change chapter character charge cheap check chief child children choice
choose church circle citizen city civil civilization claim class clean clear
clearly climb close coast cold collect college color come comfort command
commercial common community company compare complete computer concern conclusion
condition conference confidence conflict connect conquest consider consumer
contain content continue contract control conversation cook cool corner
corporate correct cost could council count country couple course court cover
create creation credit crime crisis critical cross crowd cultural culture cup
current cut

dance danger dark data daughter day dead deal death debate debt decade decide
decision declare deep defend defense define degree deliver demand democracy
department depend describe design desire desk despite destroy detail determine
develop development device die difference different difficult dig dinner direct
direction director discipline discover discuss discussion disease distance
divide do doctor document dog dollar door double doubt down draw dream dress
drink drive drop drug dry due during duty

each early earn earth ease east easy eat economic economy edge education effect
effort eight either election element else emerge employee empty end enemy energy
engage engine english enjoy enough enter entire environment equal error escape
especially essay establish even evening event ever every everyone everything
evidence exactly example exchange exist expect expense experience expert explain
express extend eye

face fact factor fail fall familiar family famous far farm fast father fear
federal feed feel feeling few field fight figure fill film final finally
financial find fine finger finish fire firm first fish fit five fix floor flow
flower fly focus follow food foot for force foreign forest forget form former
forward found four free freedom friend from front full fund future

game garden gas gather general generation generous gentle get gift girl give
glass go goal gold good govern government grace great green ground group grow
growth guess guide gun

had hair half hand hang happen happy hard harmony has hat hate have he head
health hear heart heat heavy held help her here herself high hill him himself
his history hit hold home honest hope horse hospital hot hotel hour house how
however huge human hundred hunger hungry hunt husband

idea identify if ill image imagine impact important impose improve in include
including increase indeed independent index indian individual industry influence
information initial inside instead institution interest international interview
into introduce introduction invest investment involve is island issue it item
its itself

job join joy judge jump just justice

keep key kill kind king kitchen knew knife know knowledge known

labor lack lady land language large last late later laugh law lawyer lay lead
leader learn least leave left leg legal less lesson let letter level lie life
light like likely limit line list listen literature little live local long look
lord lose loss lost lot love low luck

machine magazine main maintain major make man manage manager many map market
marriage master material matter may maybe me mean measure meat media medical
meet meeting member memory mention merchant message method middle might military
million mind mine minute miss mission model modern moment money month moral more
morning most mother motion mountain mouth move movement movie much music must my
myself mystery

name nation national natural nature near nearly necessary need network never new
news newspaper next nice night nine no none nor north not note nothing notice now
number

object obtain occur ocean of off offer office officer official often oil okay
old on once one only onto open operation opinion opportunity oppose opposite
option or order organization other others otherwise ought our ourselves out
outside over overcome own owner

page pain paint pair paper parent part particular particularly partner party
pass past path patient pattern pay peace people per perform performance perhaps
period person personal phone physical pick picture piece place plan plant play
player please pleasure plus point police policy political politics poor popular
population position positive possible poverty power practice prepare present
president press pressure pretty prevent previous price principle print prison
private probably problem process produce product production professional
professor profit program project promise property propose protect prove provide
public pull purpose pursue push put

quality question quick quickly quiet quite

race radio raise range rapid rare rate rather reach read ready real reality
realize really reason receive recent recognize record red reduce reflect reform
refuse regard region relate relation relationship religion religious remain
remember remove renounce renunciation repeat replace reply report represent
require research resource respond response responsibility rest result return
reveal rich ride right rise risk river road rock role room root rule run

sacred sad safe sale same sample save say scene school science scientist score
sea search season seat second secret section security see seek seem sell send
senior sense separate series serious serve service set settle seven several
shake shall shape share she sheet shine ship shoot shop short shot should
shoulder show side sight sign significant silence silent similar simple simply
since sing single sister sit site situation six size skill skin sky sleep slow
small smile so social society soft soldier solution solve some someone something
sometimes son song soon sort soul sound source south space speak special
specific speech spend spirit spiritual sport spring stage stand standard star
start state statement station stay step still stock stone stop store story
straight strange strategy street strength strong structure student study stuff
style subject success such suddenly suffer suggest summer sun supply support
suppose sure surface surrender survive system

table take talk task tax teach teacher team technology television tell ten tend
term test text than thank that the their them themselves then theory there these
they thing think third this those though thought thousand three through
throughout throw thus time tiny title to today together tone tonight too tool
top total touch toward town trade tradition traditional train travel treasure
treat treatment tree trial trip trouble true trust truth try turn twelve twenty
two type

under understand union unit united universe university unless until up upon us
use useful user usually

value various very victim view village violence virtue visit voice vote

wait walk wall want war watch water wave way we wealth weapon wear week weight
welcome well west western what whatever when where whether which while white who
whole whom whose why wide wife will win wind window wine winter wisdom wise wish
with within without woman women wonder word work worker world worry worth would
write writer writing wrong

yard year yes yesterday yet you young your yourself youth

zero eleven thirteen fourteen fifteen sixteen seventeen eighteen nineteen thirty
forty fifty sixty seventy eighty ninety hundred million billion first second
third fourth fifth sixth seventh eighth ninth tenth

afterword appendix author chapter conclusion contents epilogue foreword glossary
index interlude introduction note notes preface prologue reader volume
`;

const COMMON_WORDS = new Set(COMMON_WORDS_SOURCE.split(/\s+/).filter(Boolean));

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'hon', 'st', 'sr', 'jr', 'vs', 'etc',
  'eg', 'ie', 'cf', 'al', 'fig', 'no', 'vol', 'ch', 'pp', 'inc', 'ltd', 'co',
  'corp', 'dept', 'est', 'approx', 'min', 'max', 'jan', 'feb', 'mar', 'apr',
  'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

const KNOWN_ACRONYMS = new Set([
  'USA', 'US', 'UK', 'UN', 'EU', 'AI', 'PDF', 'CEO', 'CFO', 'CTO', 'COO',
  'FBI', 'CIA', 'NASA', 'NATO', 'GDP', 'IMF', 'WHO', 'WTO', 'NHS', 'BBC',
  'HIV', 'DNA', 'RNA', 'ATM', 'PIN', 'URL', 'HTTP', 'HTTPS', 'API', 'USB',
  'TV', 'PC', 'AM', 'PM', 'BC', 'AD', 'IQ', 'EQ', 'CV', 'ID', 'OK', 'PS',
  'FAQ', 'DIY', 'ASAP', 'RSVP', 'VIP', 'LLC', 'LTD', 'INC', 'NGO', 'IRS',
]);

const ROMAN_NUMERAL = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

function isRomanNumeral(word) {
  const bare = String(word || '').trim();
  return bare.length > 0 && ROMAN_NUMERAL.test(bare);
}

const ROMAN_VALUES = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function romanToInt(word) {
  const bare = String(word || '').trim().toLowerCase();
  if (!isRomanNumeral(bare)) return 0;
  let total = 0;
  for (let i = 0; i < bare.length; i += 1) {
    const value = ROMAN_VALUES[bare[i]];
    const next = ROMAN_VALUES[bare[i + 1]];
    total += next && next > value ? -value : value;
  }
  return total;
}

let userWords = null;

function loadUserWords() {
  if (userWords) return userWords;
  userWords = new Set();
  try {
    const raw = fs.readFileSync(paths.lexicon, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const word = line.trim().toLowerCase();
      if (!word || word.startsWith('#')) continue;
      for (const part of word.split(/[\s-]+/)) {
        const clean = part.replace(/[^a-z']/g, '');
        if (clean.length >= 2) userWords.add(clean);
      }
    }
  } catch {
  }
  return userWords;
}

function normaliseToken(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z']/g, '')
    .replace(/^'+|'+$/g, '');
}

function baseForms(word) {
  const forms = [word];
  const push = (candidate) => {
    if (candidate.length >= 3) forms.push(candidate);
  };

  const w = word.replace(/'s$/, '');
  if (w !== word) forms.push(w);

  if (w.endsWith('ies')) push(`${w.slice(0, -3)}y`);
  if (w.endsWith('es')) {
    push(w.slice(0, -1));
    push(w.slice(0, -2));
  }
  if (w.endsWith('s') && !w.endsWith('ss')) push(w.slice(0, -1));
  if (w.endsWith('ed')) {
    push(w.slice(0, -1));
    push(w.slice(0, -2));
  }
  if (w.endsWith('ing')) {
    push(w.slice(0, -3));
    push(`${w.slice(0, -3)}e`);
  }
  if (w.endsWith('ly')) push(w.slice(0, -2));
  if (w.endsWith('er')) {
    push(w.slice(0, -1));
    push(w.slice(0, -2));
  }
  if (w.endsWith('est')) {
    push(w.slice(0, -2));
    push(w.slice(0, -3));
  }
  if (w.endsWith('ness')) push(w.slice(0, -4));
  if (w.endsWith('ment')) push(w.slice(0, -4));

  const stem = w.replace(/(ing|ed)$/, '');
  if (stem !== w && stem.length >= 4 && stem[stem.length - 1] === stem[stem.length - 2]) {
    push(stem.slice(0, -1));
  }

  return forms;
}

function isKnownWord(token, vocab) {
  const raw = String(token || '').trim();
  if (!raw) return false;
  if (/^\d[\d.,:%-]*(st|nd|rd|th)?$/i.test(raw)) return true;

  const word = normaliseToken(raw);
  if (!word) return false;
  if (word.length >= 2 && isRomanNumeral(word)) return true;

  const extra = vocab instanceof Set ? vocab : null;
  const user = loadUserWords();

  for (const form of baseForms(word)) {
    if (COMMON_WORDS.has(form)) return true;
    if (ABBREVIATIONS.has(form)) return true;
    if (user.has(form)) return true;
    if (extra && extra.has(form)) return true;
  }
  return false;
}

export { COMMON_WORDS, ABBREVIATIONS, KNOWN_ACRONYMS, isKnownWord, isRomanNumeral, romanToInt, normaliseToken, baseForms };
