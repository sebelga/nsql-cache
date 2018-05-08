'use strict';

const nodeCacheManager = require('cache-manager');
const arrify = require('arrify');
const extend = require('extend');

const cacheKeys = require('./keys');
const cacheQueries = require('./queries');
const utils = require('./utils');

const defaultStores = [
    {
        store: 'memory',
        max: 100,
    },
];

const defaultConfig = {
    ttl: {
        keys: 60 * 10, // 10 minutes
        queries: 5, // 5 seconds
        memory: {
            keys: 60 * 10,
            queries: 5,
        },
        redis: {
            keys: 60 * 60 * 24, // 1 day
            queries: 0, // infinite
        },
    },
    cachePrefix: {
        keys: 'gck:', // Gstore Cache Key
        queries: 'gcq:', // Gstore Cache Query
    },
    hashCacheKeys: true,
    wrapClient: true,
    global: true, // For "wrapped" client, turn "ON" the cache globally or not
};

/**
 * Check if the cache is a "Redis" cache.
 * If it is, we return its client
 */
const checkRedis = cache => {
    let client;
    if (cache.store.name === 'redis') {
        client = cache.store.getClient();
    }
    return client;
};

class NsqlCache {
    constructor(settings) {
        this._config = Object.assign({}, defaultConfig);
        this._cacheManager = undefined;
        this._redisClient = undefined;
        this._db = undefined;
        this._stores = undefined;

        this.keys = cacheKeys(this);
        this.queries = cacheQueries(this);
        this.utils = utils;

        this.init(settings);
    }

    init(settings = {}) {
        const self = this;
        let { config } = settings;
        config = config || {};

        // make a copy before merging the config into the defaultConfig
        const ttlConfig = extend(true, {}, config.ttl);
        this._config = Object.assign({}, defaultConfig, config);
        extend(true, this._config.ttl, defaultConfig.ttl, ttlConfig);

        this.__setDB(settings, this._config);

        this._stores = settings.stores ? settings.stores : defaultStores;

        if (this._stores.length > 1) {
            this._stores = this._stores.map(store => nodeCacheManager.caching(store));
            this._cacheManager = nodeCacheManager.multiCaching(this._stores);
            this._stores.forEach(cache => {
                self._redisClient = self._redisClient || checkRedis(cache);
            });

            if (self._redisClient) {
                // We create a cacheManager instance without the Redis store
                // so in queries we can target this instance even though we directy
                // save into Redis client.
                // See queries.read() method
                const storeWithoutRedis = this._stores.filter(c => c.store.name !== 'redis');
                this._cacheManagerNoRedis = nodeCacheManager.multiCaching(storeWithoutRedis);
            }
        } else {
            this._cacheManager = nodeCacheManager.caching(this._stores[0]);
            this._redisClient = this._redisClient || checkRedis(this._cacheManager);

            /**
             * If we *only* have a Redis store AND no ttl config has been passed
             * we copy the default ttl config for "redis" to the "global" ttl
             */
            if (this._redisClient && !config.ttl) {
                this._config.ttl.keys = this._config.ttl.redis.keys;
                this._config.ttl.queries = this._config.ttl.redis.queries;
            }
        }

        this.__bindCacheManagerMethods();
    }

    /**
     * Concatenate key|value pairs and
     * call mset on the cacheManager
     */
    primeCache(_keys, _values, options = {}) {
        let keys = _keys;
        let values;
        if (!Array.isArray(_keys)) {
            keys = [_keys];
            /**
             * If _keys passed is not an Array but "_values" is,
             * we want to keep it that way...
             */
            if (Array.isArray(_values)) {
                values = [_values];
            }
        }
        values = values || arrify(_values);

        const cacheManager = options.cacheManager || this._cacheManager;
        const keysValues = keys.reduce((acc, key, index) => [...acc, key, values[index]], []);
        const args = [...keysValues, options];

        return cacheManager
            .mset(...args)
            .then(response => (response && response.length === 1 ? response[0] : response));
    }

    __setDB(settings, { hashCacheKeys, wrapClient } = {}) {
        if (settings.db) {
            this._db = settings.db;
            if (wrapClient && this.db.wrapClient) {
                this.db.wrapClient(this);
            }
        }

        if (!this._db) {
            throw new Error('No valid Database adapter provided.');
        }

        // Set default handlers
        this._db.getKeyFromEntity =
            this._db.getKeyFromEntity ||
            function getKeyFromEntity() {
                return null;
            };
        this._db.addKeyToEntity =
            this._db.addKeyToEntity ||
            function addKeyToEntity(_, entity) {
                return entity;
            };

        /**
         * If config.hashCacheKeys is set to true, we wrap the keyToString & queryToString
         * methods with our string.hash() util
         */
        if (this._db && hashCacheKeys) {
            const { keyToString, queryToString } = this._db;
            this._db.keyToString = key => utils.string.hash(keyToString(key));
            this._db.queryToString = query => utils.string.hash(queryToString(query));
        }
    }

    /**
     * Proxy cacheManager methods
     */
    __bindCacheManagerMethods() {
        this.get = this.cacheManager.get;
        this.mget = this.cacheManager.mget;
        this.set = this.cacheManager.set;
        this.mset = this.cacheManager.mset;
        this.del = this.cacheManager.del;
        this.reset = this.cacheManager.reset;
    }

    get config() {
        return this._config;
    }

    get redisClient() {
        return this._redisClient;
    }

    get cacheManager() {
        return this._cacheManager;
    }

    get cacheManagerNoRedis() {
        return this._cacheManagerNoRedis;
    }

    get db() {
        return this._db;
    }

    get stores() {
        return this._stores;
    }
}

module.exports = NsqlCache;
