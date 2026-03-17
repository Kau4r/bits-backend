const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
    getComputers,
    createComputer,
    updateComputer,
    deleteComputer
} = require('./computers.controller');

router.get('/', authenticateToken, asyncHandler(getComputers));
router.post('/', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(createComputer));
router.put('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(updateComputer));
router.delete('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD'), asyncHandler(deleteComputer));

module.exports = router;
