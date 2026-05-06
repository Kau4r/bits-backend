const Joi = require('joi');

const borrowingSchemas = {
    create: Joi.object({
        itemType: Joi.string().max(50),
        items: Joi.array().items(Joi.object({ itemId: Joi.number().integer().positive() })),
        purpose: Joi.string().max(500),
        roomId: Joi.number().integer().positive(),
        borrowDate: Joi.string().isoDate(),
        expectedReturnDate: Joi.string().isoDate()
    }).or('itemType', 'items'),

    updateRoom: Joi.object({
        roomId: Joi.number().integer().positive().allow(null)
    }),

    walkin: Joi.object({
        borrowerIdentifier: Joi.string().required(),
        itemId: Joi.number().integer().positive().required(),
        returnDate: Joi.string().isoDate().required(),
        purpose: Joi.string().max(500),
        roomId: Joi.number().integer().positive()
    })
};

module.exports = { borrowingSchemas };
