import express from 'express';
import * as jobStore from '../utils/jobStore.js';

const router = express.Router();

router.post('/cancel', (req, res) => {
  if (!jobStore.isBusy()) {
    return res.status(409).json({ success: false, error: 'Nothing is generating right now.' });
  }
  jobStore.cancel();
  res.json({ success: true });
});

export default router;
