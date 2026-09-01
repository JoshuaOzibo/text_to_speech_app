import express from 'express';
import health from './health.js';
import voices from './voices.js';
import preview from './preview.js';
import previewBook from './previewBook.js';
import read from './read.js';
import upload from './upload.js';
import result from './result.js';
import generate from './generate.js';
import status from './status.js';
import cancel from './cancel.js';
import audio from './audio.js';
import download from './download.js';

const router = express.Router();

router.use(health);
router.use(voices);
router.use(preview);
router.use(previewBook);
router.use(read);
router.use(upload);
router.use(result);
router.use(generate);
router.use(status);
router.use(cancel);
router.use(audio);
router.use(download);

export default router;
