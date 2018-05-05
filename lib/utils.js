'use strict';

// ----------------------------------------------------
// Strings
// ----------------------------------------------------

/**
 * Create a random string of characters
 */
const randomString = (length = 8) => {
    const chars = 'abcdefghiklmnopqrstuvwxyz';
    let randomStr = '';

    for (let i = 0; i < length; i += 1) {
        const rnum = Math.floor(Math.random() * chars.length);
        randomStr += chars.substring(rnum, rnum + 1);
    }

    return randomStr;
};

/**
 * Hash function
 *
 * @author darkskyapp
 * @link https://github.com/darkskyapp/string-hash
 */
const hashString = str => {
    /* eslint-disable no-bitwise, no-plusplus */

    let hash = 5381;
    let i = str.length;

    while (i) {
        hash = (hash * 33) ^ str.charCodeAt(--i);
    }

    /* JavaScript does bitwise operations on 32-bit signed
    * integers. Since we want the results to be always positive, convert the
    * signed int to an unsigned by doing an unsigned bitshift. */
    return hash >>> 0;
};

// ----------------------------------------------------
// Misc
// ----------------------------------------------------

const isObject = value => value instanceof Object && value.constructor === Object;

/**
 * Get the ttl value for a cache type (Keys or Queries)
 * If options.ttl is defined, it takes over. Otherwise
 * we look in the cache.config.
 * For multi-store, a function is returned so the ttl can
 * be calculated dynamically for each store.
 */
const getTTL = (cache, options, type) => {
    if (options && options.ttl) {
        /**
         * options takes over the cache config
         */
        if (isObject(options.ttl)) {
            /**
             * For multi-stores, ttl options can also
             * be an object mapping the stores
             * ex: { memory: 600, redis: 900 }
             */
            const stores = Object.assign({}, options.ttl);
            return (data, storeName) => stores[storeName];
        }
        return options.ttl;
    }

    if (cache.stores.length > 1) {
        return (data, storeName) => cache.config.ttl[storeName][type];
    }
    return cache.config.ttl[type];
};

module.exports = {
    string: {
        random: randomString,
        hash: hashString,
    },
    is: {
        object: isObject,
    },
    ttl: {
        getTTL,
    },
};
