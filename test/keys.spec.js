'use strict';

const chai = require('chai');
const sinon = require('sinon');
const nodeCacheManager = require('cache-manager');

const NsqlCache = require('../lib');
const dbAdapter = require('./mocks/db-adapter.mock');
const { string } = require('../lib/utils');
const { keys, entities } = require('./mocks/key-data');
const StoreMock = require('./mocks/cache-store');

const { expect, assert } = chai;

describe('nsqlCache.keys', () => {
    let cache;
    let cacheManager;
    let keyToString;

    const [key1, key2, key3] = keys;
    const [entity1, entity2, entity3] = entities;

    const methods = {
        fetchHandler() {
            return Promise.resolve();
        },
    };

    beforeEach(() => {
        cache = new NsqlCache({ db: dbAdapter(), config: { wrapClient: false, hashCacheKeys: false } });
        keyToString = key => cache.config.cachePrefix.keys + cache.db.keyToString(key);
        ({ cacheManager } = cache);
    });

    afterEach(() => {
        if (methods.fetchHandler.restore) {
            methods.fetchHandler.restore();
        }
    });

    describe('read()', () => {
        it('should get entity from cache (1)', () => {
            sinon.spy(methods, 'fetchHandler');
            const value = { name: string.random() };
            cacheManager.set(keyToString(key1), value);

            return cache.keys.read(key1, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result.name).equal(value.name);
                expect(result.__key).equal(key1);
            });
        });

        it('should get entity from cache (2)', () => {
            sinon.spy(methods, 'fetchHandler');
            cache.config.global = false;
            cacheManager.mset(keyToString(key1), entity1, keyToString(key2), entity2);

            return cache.keys.read([key1, key2], { cache: true }, methods.fetchHandler).then(results => {
                expect(methods.fetchHandler.called).equal(false);
                expect(results[0].name).equal('John');
                expect(results[1].name).equal('Mick');
                expect(results[0].__key).equal(key1);
                expect(results[1].__key).equal(key2);
            });
        });

        it('should get entity from fetchHandler and prime the cache', () => {
            sinon.stub(methods, 'fetchHandler').resolves([entity3]);
            const { primeCache } = cache;
            sinon.stub(cache, 'primeCache').callsFake(
                (...args) => primeCache.call(cache, ...args).then(() => 'OK') // simulate response from Redis "OK"
            );

            return cache.keys.read(key3, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(true);
                expect(result[0].name).equal('Carol');

                return cacheManager.get(keyToString(key3)).then(cacheResponse => {
                    expect(cacheResponse[0].name).equal('Carol');
                });
            });
        });

        it('should get entity from fetchHandler (2)', () => {
            sinon.stub(methods, 'fetchHandler').resolves([[entity1, entity2]]);

            return cache.keys.read([key1, key2], methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(true);
                expect(methods.fetchHandler.getCall(0).args[0].length).equal(2);
                expect(result[0].name).equal('John');
                expect(result[1].name).equal('Mick');

                return cacheManager.mget(keyToString(key1), keyToString(key2)).then(cacheResponse => {
                    expect(cacheResponse[0].name).equal('John');
                    expect(cacheResponse[1].name).equal('Mick');
                });
            });
        });

        it('should get entity from *default* fetchHandler', () => {
            sinon.stub(cache.db, 'getEntity').resolves([entity3]);

            return cache.keys.read(key3, { cache: true }).then(result => {
                expect(cache.db.getEntity.called).equal(true);
                expect(result[0].name).equal('Carol');

                return cacheManager.get(keyToString(key3)).then(cacheResponse => {
                    expect(cacheResponse[0].name).equal('Carol');
                    cache.db.getEntity.restore();
                });
            });
        });

        it('should maintain the order of the keys passed (1)', () => {
            sinon.stub(cache.db, 'getEntity').resolves([[entity2, entity1]]);

            return cache.keys.read([key1, key2]).then(result => {
                expect(result[0].name).equal('John');
                expect(result[1].name).equal('Mick');

                return cacheManager.mget(keyToString(key1), keyToString(key2)).then(cacheResponse => {
                    expect(cacheResponse[0].name).equal('John');
                    expect(cacheResponse[1].name).equal('Mick');
                    cache.db.getEntity.restore();
                });
            });
        });

        it('should maintain the order of the keys passed (2)', () => {
            cacheManager.set(keyToString(key1), entity1);
            sinon.stub(cache.db, 'getEntity').resolves([[entity3, entity2]]);

            return cache.keys.read([key1, key2, key3]).then(result => {
                expect(result[0].name).equal('John');
                expect(result[1].name).equal('Mick');
                expect(result[2].name).equal('Carol');

                return cacheManager
                    .mget(keyToString(key1), keyToString(key2), keyToString(key3))
                    .then(cacheResponse => {
                        expect(cacheResponse[0].name).equal('John');
                        expect(cacheResponse[1].name).equal('Mick');
                        expect(cacheResponse[2].name).equal('Carol');
                        cache.db.getEntity.restore();
                    });
            });
        });

        it('should maintain the order of the keys passed (3)', () => {
            cacheManager.set(keyToString(key1), entity1);
            const e = { __key: { id: 1234 } };
            sinon.stub(cache.db, 'getEntity').resolves([[undefined, e]]);

            return cache.keys.read([key1, key2, key3]).then(result => {
                expect(result[0].name).equal('John');
                expect(result[1]).equal(null);
                expect(result[2]).equal(null);
                cache.db.getEntity.restore();
            });
        });

        it('should set the TTL from config (1)', () => {
            sinon.spy(cache.cacheManager, 'mset');
            sinon.stub(methods, 'fetchHandler').resolves([entity1]);

            return cache.keys.read(key1, methods.fetchHandler).then(() => {
                assert.ok(cache.cacheManager.mset.called);
                const { args } = cache.cacheManager.mset.getCall(0);
                expect(args[2].ttl).equal(600);
                cache.cacheManager.mset.restore();
            });
        });

        it('should set the TTL from config (2)', () => {
            // When not all keys in cache
            cacheManager.set(keyToString(key1), entity1);
            sinon.spy(cache.cacheManager, 'mset');
            sinon.stub(methods, 'fetchHandler').resolves([entity2]);

            return cache.keys.read([key1, key2], methods.fetchHandler).then(() => {
                assert.ok(cache.cacheManager.mset.called);
                const { args } = cache.cacheManager.mset.getCall(0);
                expect(args[2].ttl).equal(600);
                cache.cacheManager.mset.restore();
            });
        });

        it('should set the TTL from options', () => {
            sinon.spy(cache.cacheManager, 'mset');
            sinon.stub(methods, 'fetchHandler').resolves([entity1]);

            return cache.keys.read(key1, { ttl: 6543 }, methods.fetchHandler).then(() => {
                assert.ok(cache.cacheManager.mset.called);
                const { args } = cache.cacheManager.mset.getCall(0);
                expect(args[2].ttl).equal(6543);
                cache.cacheManager.mset.restore();
            });
        });

        it('should set ttl dynamically when multistore', done => {
            const stores = {};
            sinon.stub(nodeCacheManager, 'caching').callsFake(storeName => {
                const store = StoreMock(storeName);
                stores[storeName] = store;
                return store;
            });

            cache = new NsqlCache({
                stores: ['memory', 'redis'],
                db: dbAdapter(),
                config: {
                    ttl: {
                        memory: {
                            keys: 1357,
                        },
                        redis: {
                            keys: 2468,
                        },
                    },
                },
            });

            sinon.spy(cache.cacheManager, 'mset');
            sinon.spy(stores.memory.store, 'set');
            sinon.spy(stores.redis.store, 'set');
            sinon.stub(methods, 'fetchHandler').resolves([entity1]);

            cache.keys.read(key1, methods.fetchHandler).then(() => {
                const options = cache.cacheManager.mset.getCall(0).args[2];
                const optMemory = stores.memory.store.set.getCall(0).args[2];
                const optRedis = stores.redis.store.set.getCall(0).args[2];

                expect(typeof options.ttl).equal('function');
                expect(optMemory.ttl).equal(1357);
                expect(optRedis.ttl).equal(2468);

                cache.keys.read(key1, { ttl: { memory: 555, redis: 777 } }, methods.fetchHandler).then(() => {
                    const options2 = cache.cacheManager.mset.getCall(1).args[2];
                    const optMemory2 = stores.memory.store.set.getCall(1).args[2];
                    const optRedis2 = stores.redis.store.set.getCall(1).args[2];

                    expect(typeof options2.ttl).equal('function');
                    expect(optMemory2.ttl).equal(555);
                    expect(optRedis2.ttl).equal(777);

                    stores.memory.store.set.restore();
                    stores.redis.store.set.restore();
                    nodeCacheManager.caching.restore();
                    done();
                });
            });
        });

        it('should prime the cache after fetch', () => {
            sinon.stub(methods, 'fetchHandler').resolves([[entity1, entity2]]);

            return cache.keys.read([key1, key2], methods.fetchHandler).then(() =>
                cacheManager.mget(keyToString(key1), keyToString(key2)).then(results => {
                    expect(results[0].name).equal('John');
                    expect(results[1].name).equal('Mick');
                })
            );
        });

        it('should get entities from cache + fetch', () => {
            cacheManager.set(keyToString(key1), entity1);
            cacheManager.set(keyToString(key2), entity2);

            sinon.stub(methods, 'fetchHandler').resolves([entity3]);
            const { primeCache } = cache;
            sinon.stub(cache, 'primeCache').callsFake(
                (...args) => primeCache.call(cache, ...args).then(() => 'OK') // simulate response from Redis "OK"
            );

            return cache.keys.read([key1, key2, key3], methods.fetchHandler).then(results => {
                expect(methods.fetchHandler.called).equal(true);
                expect(results[0].name).equal('John');
                expect(results[1].name).equal('Mick');
                expect(results[2].name).equal('Carol');

                expect(results[0].__key).equal(key1);
                expect(results[1].__key).equal(key2);
                expect(results[2].__key).equal(key3);
            });
        });

        it('should return "null" for fetch not found ("ERR_ENTITY_NOT_FOUND")', () => {
            const error = new Error('not found');
            error.code = 'ERR_ENTITY_NOT_FOUND';

            cacheManager.set(keyToString(key1), entity1);
            sinon.stub(methods, 'fetchHandler').returns(Promise.reject(error));

            return cache.keys.read([key1, key2], methods.fetchHandler).then(result => {
                expect(result[0].name).equal('John');
                expect(result[1]).equal(null);
            });
        });

        it('should bubble up the error from the fetch (1)', done => {
            const error = new Error('Houston we got an error');

            sinon.stub(methods, 'fetchHandler').rejects(error);

            cache.keys.read(key1, methods.fetchHandler).catch(err => {
                expect(err.message).equal('Houston we got an error');
                done();
            });
        });

        it('should bubble up the error from the fetch (2)', () => {
            const error = new Error('Houston we got an error');
            cacheManager.set(keyToString(key1), entity1);
            sinon.stub(methods, 'fetchHandler').rejects(error);

            return cache.keys.read([key1, key2], methods.fetchHandler).catch(err => {
                expect(err.message).equal('Error: Houston we got an error');
            });
        });
    });

    describe('get()', () => {
        it('should get key from cache', () => {
            const value = { name: string.random() };
            return cache.keys.set(key1, value).then(() =>
                cache.keys.get(key1).then(res => {
                    expect(res.name).equal(value.name);
                })
            );
        });

        it('should return undefined if no entity found', () =>
            cache.keys.get(key1).then(res => {
                expect(typeof res).equal('undefined');
            }));

        it('should add KEY Symbol to response from cache', () => {
            const value = { name: 'john' };
            return cache.keys.set(key1, value).then(() =>
                cache.keys.get(key1).then(res => {
                    assert.ok(!Array.isArray(res));
                    expect(res).include(value);
                    expect(res.__key).equal(key1);
                })
            );
        });

        it('should get multiple keys from cache', () => {
            const value1 = { name: string.random() };
            const value2 = { name: string.random() };
            return cache.keys.set(key1, value1, key2, value2).then(() =>
                cache.keys.mget(key1, key2).then(res => {
                    expect(res[0].name).equal(value1.name);
                    expect(res[1].name).equal(value2.name);
                    expect(res[0].__key).equal(key1);
                    expect(res[1].__key).equal(key2);
                })
            );
        });
    });

    describe('set()', () => {
        it('should add key to cache', () => {
            const value = { name: 'john' };
            sinon.spy(cache, 'set');
            return cache.keys.set(key1, value).then(result => {
                assert.ok(cache.set.called);
                const { args } = cache.set.getCall(0);
                expect(args[0]).equal(keyToString(key1));
                expect(result.name).equal('john');
            });
        });

        it('should set the TTL from config', () => {
            sinon.spy(cache, 'set');
            return cache.keys.set(key1, entity1).then(() => {
                const { args } = cache.set.getCall(0);
                expect(args[2].ttl).equal(600);
            });
        });

        it('should set the TTL from options', () => {
            sinon.spy(cache, 'set');
            return cache.keys.set(key1, entity1, { ttl: 9988 }).then(() => {
                const { args } = cache.set.getCall(0);
                expect(args[2].ttl).equal(9988);
            });
        });

        it('should set ttl dynamically when multistore', () => {
            const stores = {};
            sinon.stub(nodeCacheManager, 'caching').callsFake(storeName => {
                const store = StoreMock(storeName);
                stores[storeName] = store;
                return store;
            });

            cache = new NsqlCache({
                db: dbAdapter(),
                stores: ['memory', 'redis'],
                config: {
                    ttl: {
                        memory: {
                            keys: 1357,
                        },
                        redis: {
                            keys: 2468,
                        },
                    },
                },
            });

            sinon.spy(cache, 'set');
            sinon.spy(stores.memory.store, 'set');
            sinon.spy(stores.redis.store, 'set');
            sinon.stub(methods, 'fetchHandler').resolves([entity1]);

            return cache.keys.set(key1, entity1).then(() => {
                const options = cache.set.getCall(0).args[2];
                const optMemory = stores.memory.store.set.getCall(0).args[2];
                const optRedis = stores.redis.store.set.getCall(0).args[2];

                expect(typeof options.ttl).equal('function');
                expect(optMemory.ttl).equal(1357);
                expect(optRedis.ttl).equal(2468);

                stores.memory.store.set.restore();
                stores.redis.store.set.restore();
                nodeCacheManager.caching.restore();
            });
        });
    });

    describe('mset()', () => {
        it('should add multiple keys to cache', () => {
            const value1 = { name: 'john' };
            const value2 = { name: 'mick' };
            sinon.spy(cache, 'mset');

            return cache.keys.mset(key1, value1, key2, value2).then(result => {
                assert.ok(cache.mset.called);
                const { args } = cache.mset.getCall(0);
                expect(args[0]).equal(keyToString(key1));
                expect(args[1]).equal(value1);
                expect(args[2]).equal(keyToString(key2));
                expect(args[3]).equal(value2);
                expect(result).include.members([value1, value2]);
            });
        });

        it('should set the TTL from config', () => {
            sinon.spy(cache, 'mset');

            return cache.keys.mset(key1, {}, key2, {}).then(() => {
                const { args } = cache.mset.getCall(0);
                expect(args[4].ttl).equal(600);
            });
        });

        it('should set the TTL from options', () => {
            sinon.spy(cache, 'mset');

            return cache.keys.mset(key1, {}, key2, {}, { ttl: 5533 }).then(() => {
                const { args } = cache.mset.getCall(0);
                expect(args[4].ttl).equal(5533);
            });
        });
    });

    describe('del()', () => {
        it('should delete 1 key from cache', () => {
            sinon.spy(cache, 'del');
            return cache.keys.del(key1).then(() => {
                assert.ok(cache.del.called);
                const { args } = cache.del.getCall(0);
                expect(args[0]).deep.equal([keyToString(key1)]);
            });
        });

        it('should delete multiple keys from cache', () => {
            sinon.spy(cache, 'del');
            return cache.keys.del(key1, key2, key3).then(() => {
                assert.ok(cache.del.called);
                const { args } = cache.del.getCall(0);
                expect(args[0][0]).deep.equal(keyToString(key1));
                expect(args[0][1]).deep.equal(keyToString(key2));
                expect(args[0][2]).deep.equal(keyToString(key3));
            });
        });
    });
});
