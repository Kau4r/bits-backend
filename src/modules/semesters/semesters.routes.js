const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
    getSemesters,
    getActiveSemester,
    createSemester,
    activateSemester,
} = require('./semesters.controller');

router.get('/', authenticateToken, asyncHandler(getSemesters));
router.get('/active', authenticateToken, asyncHandler(getActiveSemester));

router.post('/',
    authenticateToken,
    authorize('ADMIN', 'LAB_HEAD'),
    asyncHandler(createSemester),
);

router.patch('/:id/activate',
    authenticateToken,
    authorize('ADMIN', 'LAB_HEAD'),
    asyncHandler(activateSemester),
);

module.exports = router;
