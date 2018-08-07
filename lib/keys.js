'use strict';

const arrify = require('arrify');

const utils = require('./utils');

const { is } = utils;
const { getTTL } = utils.ttl;

/**
 * gstore-node error code when entity is not found.
 */
const ERR_ENTITY_NOT_FOUND = 'ERR_ENTITY_NOT_FOUND';

module.exports = cache => {
    const addCachePrefixKeys = key => cache.config.cachePrefix.keys + key;
    const keyToString = key => addCachePrefixKeys(cache.db.keyToString(key));

    /**
     * Order a list of entities according to a list of keys.
     * As some NoSQL database might not maintain the order of the keys passed
     * in their response, this will garantee the order to save them in the cache
     */
    const orderEntities = (entities, keys) => {
        const entitiesByKey = {};
        entities.forEach(entity => {
            if (typeof entity === 'undefined') {
                return;
            }
            entitiesByKey[keyToString(cache.db.getKeyFromEntity(entity))] = entity;
        });
        return keys.map(key => entitiesByKey[keyToString(key)] || undefined);
    };

    // Attach Key to cache result
    const addKeyToEntity = (entities, keys) => entities.map((entity, i) => cache.db.addKeyToEntity(keys[i], entity));

    const read = (keys, ...args) => {
        let fetchHandler = args.length > 1 ? args[1] : args[0];

        if (typeof fetchHandler !== 'function') {
            /**
             * If no fetchHandler is passed, defaults to the cache db getEntity() method
             * unless we already wrapped the datastore.get and we have an _originalGet function attached
             */
            fetchHandler = _keys => {
                if (cache.db.getEntityUnWrapped) {
                    return cache.db.getEntityUnWrapped(_keys);
                }
                return cache.db.getEntity(_keys);
            };
        }

        const options = is.object(args[0]) ? args[0] : {};
        options.ttl = getTTL(cache, options, 'keys');

        const isMultiple = Array.isArray(keys) && keys.length > 1;

        /**
         * Convert the keys to unique string id
         */
        const stringKeys = isMultiple ? keys.map(keyToString) : keyToString(keys);
        const _args = [...stringKeys, options];

        if (isMultiple) {
            return cache.cacheManager.mget(..._args).then(onResult);
        }

        return cache.cacheManager.get(stringKeys, options).then(onResult);

        function onResult(_cacheResult) {
            const cacheResult = arrify(_cacheResult).filter(r => r !== undefined);

            if (cacheResult.length === 0) {
                /**
                 * No cache we need to fetch the keys
                 */
                return fetchHandler(keys).then(_fetchResult => {
                    // We make sure the order of the entities returned by the fetchHandler
                    // is the same as the order of the keys provided.
                    const fetchResult = isMultiple ? orderEntities(arrify(_fetchResult[0]), keys) : _fetchResult;

                    // Prime the cache
                    return cache.primeCache(stringKeys, fetchResult, options).then(() => fetchResult);
                });
            }

            if (isMultiple && cacheResult.length !== keys.length) {
                /**
                 * The cache returned some entities but not all of them
                 */
                const cached = {};
                let strKey;

                const addToCache = entity => {
                    if (!entity) {
                        return;
                    }
                    strKey = keyToString(cache.db.getKeyFromEntity(entity));
                    cached[strKey] = entity;
                };

                cacheResult.forEach(addToCache);
                const keysNotFound = keys.filter(k => cached[keyToString(k)] === undefined);

                return fetchHandler(keysNotFound)
                    .then(_fetchResult => {
                        // Make sure we the fetchResult is in the same order as the keys that we fetched
                        const fetchResult = orderEntities(arrify(_fetchResult[0]), keysNotFound);
                        fetchResult.forEach(addToCache);

                        /**
                         * Prime the cache
                         */
                        return cache.primeCache(keysNotFound.map(keyToString), fetchResult, options);
                    })
                    .catch(error => {
                        if (error.code === ERR_ENTITY_NOT_FOUND) {
                            // When we fetch *one* key and it is not found
                            // gstore.Model returns an error with 404 code.
                            strKey = keyToString(keysNotFound[0]);
                            cached[strKey] = null;
                            return;
                        }
                        throw new Error(error);
                    })
                    .then(() =>
                        // Map the keys to our cached map
                        // return "null" if no result
                        stringKeys.map(k => cached[k] || null)
                    );
            }
            return isMultiple
                ? addKeyToEntity(cacheResult, keys)
                : addKeyToEntity(arrify(cacheResult), arrify(keys))[0];
        }
    };

    const mget = (..._keys) => {
        const keys = _keys.map(k => keyToString(k));
        if (keys.length === 1) {
            return cache.get(keys[0]).then(_entity => {
                if (typeof _entity === 'undefined') {
                    return _entity;
                }
                return addKeyToEntity([_entity], _keys)[0];
            });
        }

        return cache.mget(...keys).then(entities => addKeyToEntity(entities, _keys));
    };

    const get = mget;

    const mset = (..._keysValues) => {
        let options = _keysValues.length % 2 > 0 ? _keysValues.pop() : {};
        options = { ttl: getTTL(cache, options, 'keys') };

        // Convert Datastore Keys to unique string id
        const keysValues = _keysValues.map((kv, i) => {
            if (i % 2 === 0) {
                return addCachePrefixKeys(cache.db.keyToString(kv));
            }
            return kv;
        });

        const multi = keysValues.length > 2;
        if (multi) {
            return cache.mset(...keysValues, options).then(() => {
                // The reponse is the odd index from the keysValues
                const response = keysValues.filter((v, i) => i % 2 > 0);
                return response;
            });
        }

        return cache.set(keysValues[0], keysValues[1], options).then(() => keysValues[1]);
    };

    const set = mset;

    const del = (...keys) => cache.del(keys.map(k => keyToString(k)));

    return {
        read,
        get,
        mget,
        set,
        mset,
        del,
    };
};
