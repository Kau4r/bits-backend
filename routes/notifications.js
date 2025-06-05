const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const notificationsService = require('../services/notifications');

// Get all notifications for authenticated user
router.get('/', auth, async (req, res) => {
    try {
        const notifications = await notificationsService.getAll(req.user.id);
        res.json({
            status: 'success',
            data: notifications
        });
    } catch (error) {
        res.status(400).json({
            status: 'error',
            message: error.message
        });
    }
});

// Get notification by ID
router.get('/:id', auth, async (req, res) => {
    try {
        const notification = await notificationsService.getById(req.user.id, req.params.id);
        res.json({
            status: 'success',
            data: notification
        });
    } catch (error) {
        res.status(404).json({
            status: 'error',
            message: error.message
        });
    }
});

// Create new notification
router.post('/', auth, async (req, res) => {
    try {
        const notification = await notificationsService.create(req.user.id, req.body);
        res.status(201).json({
            status: 'success',
            data: notification
        });
    } catch (error) {
        res.status(400).json({
            status: 'error',
            message: error.message
        });
    }
});

// Update notification
router.put('/:id', auth, async (req, res) => {
    try {
        const notification = await notificationsService.update(req.user.id, req.params.id, req.body);
        res.json({
            status: 'success',
            data: notification
        });
    } catch (error) {
        res.status(400).json({
            status: 'error',
            message: error.message
        });
    }
});

// Delete notification
router.delete('/:id', auth, async (req, res) => {
    try {
        const result = await notificationsService.delete(req.user.id, req.params.id);
        res.json({
            status: 'success',
            message: result.message
        });
    } catch (error) {
        res.status(404).json({
            status: 'error',
            message: error.message
        });
    }
});

module.exports = router;
