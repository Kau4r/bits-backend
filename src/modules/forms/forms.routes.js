const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
    getForms,
    getFormById,
    createForm,
    updateForm,
    archiveForm,
    transferForm,
    addFormAttachments,
    deleteForm
} = require('./forms.controller');

router.get('/', authenticateToken, asyncHandler(getForms));
router.get('/:id', authenticateToken, asyncHandler(getFormById));
router.post('/', authenticateToken, asyncHandler(createForm));
router.patch('/:id', authenticateToken, asyncHandler(updateForm));
router.patch('/:id/archive', authenticateToken, asyncHandler(archiveForm));
router.post('/:id/transfer', authenticateToken, asyncHandler(transferForm));
router.post('/:id/attachments', authenticateToken, asyncHandler(addFormAttachments));
router.delete('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD'), asyncHandler(deleteForm));

module.exports = router;
