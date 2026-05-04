const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
    getSuggestions,
    createSuggestion,
    updateSuggestion,
    deleteSuggestion,
} = require('./computerSuggestions.controller');

router.get('/', authenticateToken, asyncHandler(getSuggestions));
router.post('/', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(createSuggestion));
router.put('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(updateSuggestion));
router.delete('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(deleteSuggestion));

module.exports = router;
