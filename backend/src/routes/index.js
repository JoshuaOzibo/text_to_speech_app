'use strict';

const express = require('express');

const router = express.Router();

router.use(require('./health'));
router.use(require('./voices'));
router.use(require('./preview'));
router.use(require('./previewBook'));
router.use(require('./upload'));
router.use(require('./result'));
router.use(require('./generate'));
router.use(require('./status'));
router.use(require('./cancel'));
router.use(require('./audio'));
router.use(require('./download'));

module.exports = router;
