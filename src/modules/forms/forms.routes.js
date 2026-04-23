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
    unarchiveForm,
    transferForm,
    setFormReceived,
    addFormAttachments,
    deleteFormAttachment,
    deleteForm
} = require('./forms.controller');

const canManageForms = authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH');

router.get('/', authenticateToken, canManageForms, asyncHandler(getForms));
router.get('/:id', authenticateToken, canManageForms, asyncHandler(getFormById));
router.post('/', authenticateToken, canManageForms, asyncHandler(createForm));
router.patch('/:id', authenticateToken, canManageForms, asyncHandler(updateForm));
router.patch('/:id/archive', authenticateToken, canManageForms, asyncHandler(archiveForm));
router.patch('/:id/unarchive', authenticateToken, canManageForms, asyncHandler(unarchiveForm));
router.patch('/:id/received', authenticateToken, canManageForms, asyncHandler(setFormReceived));
router.post('/:id/transfer', authenticateToken, canManageForms, asyncHandler(transferForm));
router.post('/:id/attachments', authenticateToken, canManageForms, asyncHandler(addFormAttachments));
router.delete('/:id/attachments/:attachmentId', authenticateToken, canManageForms, asyncHandler(deleteFormAttachment));
router.delete('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD'), asyncHandler(deleteForm));

module.exports = router;
