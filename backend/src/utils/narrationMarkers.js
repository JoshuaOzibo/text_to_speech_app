
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

export {
  INTRO_OPENER,
  INTRO_LINE,
  OUTRO_OPENER,
  INTRO_CUE,
  INTRO_CLOSER,
  introOpening,
  outroOpening,
};
