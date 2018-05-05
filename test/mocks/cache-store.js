'use strict';

const redis = require('redis-mock');

const client = redis.createClient();

const getCallback = (...args) => args.pop();

module.exports = (name = 'memory') => ({
    store: {
        name,
        options: {},
        getClient: () => client,
        reset: (...args) => {
            const cb = getCallback(...args);
            if (typeof cb === 'function') {
                return cb();
            }
            return Promise.resolve();
        },
        set: (...args) => {
            const cb = getCallback(...args);
            if (typeof cb === 'function') {
                return cb();
            }
            return Promise.resolve();
        },
        mset: (...args) => {
            const cb = getCallback(...args);
            if (typeof cb === 'function') {
                return cb();
            }
            return Promise.resolve();
        },
        get: (...args) => {
            const cb = getCallback(...args);
            if (typeof cb === 'function') {
                return cb();
            }
            return Promise.resolve();
        },
        mget: (...args) => {
            const cb = getCallback(...args);
            if (typeof cb === 'function') {
                return cb();
            }
            return Promise.resolve();
        },
        del: (...args) => {
            const cb = getCallback(...args);
            if (typeof cb === 'function') {
                return cb();
            }
            return Promise.resolve();
        },
    },
});
