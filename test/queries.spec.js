'use strict';

const chai = require('chai');
const sinon = require('sinon');
const requireUncached = require('require-uncached');
const nodeCacheManager = require('cache-manager');

const { string } = require('../lib/utils');
const { queries } = require('./mocks/key-data');
const dbAdapter = require('./mocks/db-adapter.mock');
const StoreMock = require('./mocks/cache-store');

const { expect, assert } = chai;
const metaQuery = {
    endCursor: 'Cj4SOGoWZ3N0b3JlLWNhY2hlLWUyZS10Z==',
    moreResults: 'MORE_RESULTS_AFTER_LIMIT',
};

describe('gstoreCache.queries', () => {
    let cache;
    let queryToString;
    let cacheManager;
    let queryRes;
    let redisClient;
    let prefix;

    const [query1, query2, query3] = queries;

    const methods = {
        fetchHandler() {
            return Promise.resolve([]);
        },
    };

    describe('read()', () => {
        const NsqlCache = requireUncached('../lib');
        let defaultConfig;

        beforeEach(() => {
            cache = new NsqlCache({ db: dbAdapter(), config: { wrapClient: false } });
            defaultConfig = Object.assign({}, cache.config);

            queryRes = [[{ name: string.random() }], metaQuery];
            sinon.stub(methods, 'fetchHandler').resolves(queryRes);

            prefix = cache.config.cachePrefix.queries;
            queryToString = query => prefix + cache.db.queryToString(query);
            ({ cacheManager } = cache);
        });

        afterEach(() => {
            // make sure we have the default config in
            // case it has been modified
            cache._config = defaultConfig;

            if (methods.fetchHandler.restore) {
                methods.fetchHandler.restore();
            }

            if (cache.cacheManager) {
                cache.cacheManager.reset();
            }
            if (cache.cacheManagerNoRedis) {
                cache.cacheManagerNoRedis.reset();
            }
        });

        it('should get query from fetchHandler', () => {
            const strQuery = queryToString(query1);
            sinon.spy(cache, 'primeCache');

            return cache.queries.read(query1, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(true);
                expect(result).equal(queryRes);
                expect(cache.primeCache.getCall(0).args[0]).equal(strQuery);

                return cacheManager.get(strQuery).then(cacheResponse => {
                    expect(cacheResponse[0].name).equal(queryRes[0].name);

                    cache.primeCache.restore();
                });
            });
        });

        it('should get query from cache (1)', () => {
            cacheManager.set(queryToString(query1), queryRes);

            return cache.queries.read(query1, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result[0].name).equal(queryRes[0].name);
            });
        });

        it('should get query from cache (2)', () => {
            cache.config.global = false;
            cacheManager.set(queryToString(query1), queryRes);

            return cache.queries.read(query1, { cache: true }, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result[0].name).equal(queryRes[0].name);
            });
        });

        it('should prime the cache after fetch', () =>
            cache.queries.read(query1, methods.fetchHandler).then(() =>
                cache.cacheManager.get(queryToString(query1)).then(result => {
                    expect(result[0].name).equal(queryRes[0].name);
                })
            ));

        it('should get query from *default* fetchHandler', () => {
            sinon.stub(query1, 'run').resolves(queryRes);

            return cache.queries.read(query1, { cache: true }).then(result => {
                expect(query1.run.called).equal(true);
                expect(result[0].name).equal(queryRes[0].name);

                return cacheManager.get(queryToString(query1)).then(cacheResponse => {
                    expect(cacheResponse[0].name).equal(queryRes[0].name);
                });
            });
        });

        it('should set the TTL from config', () => {
            sinon.spy(cache.cacheManager, 'mset');

            return cache.queries.read(query1, methods.fetchHandler).then(() => {
                assert.ok(cache.cacheManager.mset.called);
                const { args } = cache.cacheManager.mset.getCall(0);
                expect(args[2].ttl).equal(5);
                cache.cacheManager.mset.restore();
            });
        });

        it('should set the TTL from options', () => {
            sinon.spy(cache.cacheManager, 'mset');

            return cache.queries.read(query1, { ttl: 556 }).then(() => {
                assert.ok(cache.cacheManager.mset.called);
                const { args } = cache.cacheManager.mset.getCall(0);
                expect(args[2].ttl).equal(556);
                cache.cacheManager.mset.restore();
            });
        });

        it('should set ttl dynamically when multistore', () =>
            new Promise(resolve => {
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
                                queries: 1357,
                            },
                            redis: {
                                queries: 2468,
                            },
                        },
                        wrapClient: false,
                    },
                });

                sinon.spy(cache.cacheManagerNoRedis, 'mset');
                sinon.spy(stores.memory.store, 'set');
                sinon.spy(cache.redisClient, 'multi');

                cache.queries.read(query1, methods.fetchHandler).then(() => {
                    const options = cache.cacheManagerNoRedis.mset.getCall(0).args[2];
                    const optMemory = stores.memory.store.set.getCall(0).args[2];
                    const argsRedis = cache.redisClient.multi.getCall(0).args[0];

                    expect(typeof options.ttl).equal('function');
                    expect(optMemory.ttl).equal(1357);
                    expect(argsRedis[1]).contains('setex');
                    expect(argsRedis[1]).contains(2468);

                    cache.queries
                        .read(query1, { ttl: { memory: 4455, redis: 6677 } }, methods.fetchHandler)
                        .then(() => {
                            const options2 = cache.cacheManagerNoRedis.mset.getCall(0).args[2];
                            const optMemory2 = stores.memory.store.set.getCall(1).args[2];
                            const argsRedis2 = cache.redisClient.multi.getCall(1).args[0];

                            expect(typeof options2.ttl).equal('function');
                            expect(optMemory2.ttl).equal(4455);
                            expect(argsRedis2[1]).contains('setex');
                            expect(argsRedis2[1]).contains(6677);

                            cache.cacheManagerNoRedis.mset.restore();
                            stores.memory.store.set.restore();
                            cache.redisClient.multi.restore();
                            nodeCacheManager.caching.restore();

                            resolve();
                        });
                });
            }));

        it('should bubble up the error from the fetch', done => {
            const error = new Error('Houston we got an error');
            methods.fetchHandler.rejects(error);

            cache.queries.read(query1, methods.fetchHandler).catch(err => {
                expect(err.message).equal('Houston we got an error');
                done();
            });
        });

        context('when redis cache present', () => {
            afterEach(() => {
                cache.primeCache.restore();
                cache.queries.kset.restore();
            });

            it('should not prime the cache and save the query in its entity Kind Set', done => {
                cache = StoreMock('redis');

                cache = new NsqlCache({
                    db: dbAdapter(),
                    stores: [cache],
                    config: {
                        ttl: {
                            redis: { queries: 0 }, // when set to "0" triggers infinite cache
                        },
                        wrapClient: false,
                    },
                });

                sinon.spy(cache, 'primeCache');
                sinon.spy(cache.queries, 'kset');

                const queryKey = queryToString(query1);

                cache.queries.read(query1, methods.fetchHandler).then(result => {
                    expect(cache.primeCache.called).equal(false);
                    expect(cache.queries.kset.called).equal(true);

                    const { args } = cache.queries.kset.getCall(0);
                    expect(args[0]).equal(queryKey);
                    expect(args[1][0][0]).contains(queryRes[0][0]);
                    expect(args[1][1]).equal(queryRes[1]);
                    expect(args[2]).equal('Company');
                    expect(result).equal(queryRes);
                    done();
                });
            });
        });
    });

    describe('get()', () => {
        const NsqlCache = requireUncached('../lib');

        beforeEach(() => {
            cache = new NsqlCache({ db: dbAdapter(), config: { wrapClient: false } });
            queryRes = [[{ name: string.random() }], metaQuery];

            prefix = cache.config.cachePrefix.queries;
            queryToString = query => prefix + cache.db.queryToString(query);
        });

        it('should get query from cache', () =>
            cache.queries.set(query1, queryRes).then(() =>
                cache.queries.get(query1).then(res => {
                    expect(res).deep.equal(queryRes);
                })
            ));

        it('should return undefined if query not found', () =>
            cache.queries.get(query1).then(res => {
                assert.ok(!res);
            }));

        it('should put back Symbol keys on entities', () => {
            const myKey = { id: 123456789 };
            queryRes[0][0].__dsKey__ = myKey;

            return cache.set(queryToString(query1), queryRes).then(() =>
                cache.queries.get(query1).then(res => {
                    expect(res[0][0].__key).equal(myKey);
                })
            );
        });
    });

    describe('mget()', () => {
        const NsqlCache = requireUncached('../lib');

        beforeEach(() => {
            queryRes = [[{ name: string.random() }], metaQuery];
            cache = new NsqlCache({ db: dbAdapter(), config: { wrapClient: false } });
            prefix = cache.config.cachePrefix.queries;
            queryToString = query => prefix + cache.db.queryToString(query);
        });

        it('should get multiple queries from cache', () => {
            const queryRes2 = [[{ name: string.random() }], metaQuery];
            return cache.queries.mset(query1, queryRes, query2, queryRes2).then(() =>
                cache.queries.mget(query1, query2).then(res => {
                    expect(res[0]).deep.equal(queryRes);
                    expect(res[1]).deep.equal(queryRes2);
                })
            );
        });

        it('should filter out undefined values', () =>
            cache.queries.set(query2, [[{ a: 123 }]], { ttl: 600 }).then(() =>
                cache.queries.mget(query1, query2).then(res => {
                    expect(res[1][0][0].a).equal(123);
                })
            ));
    });

    describe('set()', () => {
        const NsqlCache = requireUncached('../lib');

        beforeEach(() => {
            cache = new NsqlCache({ db: dbAdapter(), config: { wrapClient: false } });
            queryRes = [[{ name: string.random() }], metaQuery];

            prefix = cache.config.cachePrefix.queries;
            queryToString = query => prefix + cache.db.queryToString(query);
            sinon.spy(cache, 'set');
        });

        afterEach(() => {
            if (cache.set.restore) {
                cache.set.restore();
            }
        });

        it('should add Datastore Query to cache', () =>
            cache.queries.set(query1, queryRes).then(result => {
                assert.ok(cache.set.called);
                const { args } = cache.set.getCall(0);
                expect(args[0]).equal(queryToString(query1));
                expect(result).deep.equal(queryRes);
            }));

        it('should set the TTL from config', () =>
            cache.queries.set(query1, queryRes).then(() => {
                const { args } = cache.set.getCall(0);
                expect(args[2].ttl).equal(5);
            }));

        it('should set the TTL from options', () =>
            cache.queries.set(query1, queryRes, { ttl: 6969 }).then(() => {
                const { args } = cache.set.getCall(0);
                expect(args[2].ttl).equal(6969);
            }));

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
                            queries: 1357,
                        },
                        redis: {
                            queries: 2468,
                        },
                    },
                    wrapClient: false,
                },
            });

            sinon.spy(cache.cacheManagerNoRedis, 'mset');
            sinon.spy(stores.memory.store, 'set');
            sinon.spy(cache.redisClient, 'multi');

            return cache.queries.set(query1, queryRes).then(() => {
                const options = cache.cacheManagerNoRedis.mset.getCall(0).args[2];
                const optMemory = stores.memory.store.set.getCall(0).args[2];
                const argsRedis = cache.redisClient.multi.getCall(0).args[0];

                expect(typeof options.ttl).equal('function');
                expect(optMemory.ttl).equal(1357);
                expect(argsRedis[1]).contains('setex');
                expect(argsRedis[1]).contains(2468);

                cache.cacheManagerNoRedis.mset.restore();
                stores.memory.store.set.restore();
                cache.redisClient.multi.restore();
                nodeCacheManager.caching.restore();
            });
        });

        context('when redis cache present', () => {
            beforeEach(() => {
                cache = new NsqlCache({
                    db: dbAdapter(),
                    stores: [StoreMock('redis')],
                    config: {
                        ttl: {
                            queries: 333,
                        },
                        wrapClient: false,
                    },
                });
                sinon.spy(cache.queries, 'kset');
            });

            afterEach(() => {
                cache.queries.kset.restore();
            });

            it('should not prime the cache and save the query in its entity Kind Set', done => {
                sinon.spy(cache, 'set');
                sinon.spy(cache.redisClient, 'multi');

                cache.queries.set(query1, queryRes).then(() => {
                    expect(cache.set.called).equal(false);
                    expect(cache.queries.kset.called).equal(false);

                    const argsRedis = cache.redisClient.multi.getCall(0).args[0];
                    expect(argsRedis[1]).contains('setex');
                    expect(argsRedis[1]).contains(333);

                    cache.redisClient.multi.restore();
                    done();
                });
            });
        });
    });

    describe('mset()', () => {
        const NsqlCache = requireUncached('../lib');

        beforeEach(() => {
            cache = new NsqlCache({ db: dbAdapter(), config: { wrapClient: false } });
            queryRes = [[{ name: string.random() }], metaQuery];

            prefix = cache.config.cachePrefix.queries;
            queryToString = query => prefix + cache.db.queryToString(query);
            sinon.spy(cache, 'mset');
        });

        afterEach(() => {
            if (cache.mset.restore) {
                cache.mset.restore();
            }
        });

        it('should add Datastore Query to cache', () => {
            const queryRes2 = [[{ name: string.random() }], metaQuery];
            return cache.queries.mset(query1, queryRes, query2, queryRes2).then(result => {
                assert.ok(cache.mset.called);
                const { args } = cache.mset.getCall(0);
                expect(args[0]).equal(queryToString(query1));
                expect(args[1]).equal(queryRes);
                expect(args[2]).equal(queryToString(query2));
                expect(args[3]).equal(queryRes2);
                expect(result).include.members([queryRes, queryRes2]);
            });
        });

        it('should set the TTL from config', () => {
            const queryRes2 = [[{ name: string.random() }], metaQuery];
            return cache.queries.set(query1, queryRes, query2, queryRes2).then(() => {
                const { args } = cache.mset.getCall(0);
                expect(args[4].ttl).equal(5);
            });
        });

        it('should set the TTL from options', () => {
            const queryRes2 = [[{ name: string.random() }], metaQuery];
            return cache.queries.set(query1, queryRes, query2, queryRes2, { ttl: 7744 }).then(() => {
                const { args } = cache.mset.getCall(0);
                expect(args[4].ttl).equal(7744);
            });
        });

        context('when redis cache present', () => {
            let storeRedis;

            beforeEach(() => {
                storeRedis = StoreMock('redis');

                cache = new NsqlCache({
                    db: dbAdapter(),
                    stores: [storeRedis],
                    config: {
                        ttl: {
                            redis: { queries: 0 },
                        },
                        wrapClient: false,
                    },
                });
                sinon.spy(cache.queries, 'kset');
            });

            it('save the query in a Redis Set for the Entity Kind', () => {
                sinon.spy(cache, 'mset');
                const queryKey = queryToString(query1);
                const queryKey2 = queryToString(query2);
                const queryRes2 = [[{ name: string.random() }], metaQuery];

                return cache.queries.mset(query1, queryRes, query2, queryRes2).then(result => {
                    expect(cache.mset.called).equal(false);
                    expect(cache.queries.kset.callCount).equal(2);

                    const { args: args1 } = cache.queries.kset.getCall(0);
                    const [qKey, qValue, qEntiyKind] = args1;
                    expect(qKey).equal(queryKey);
                    expect(qValue[0][0]).contains(queryRes[0][0]);
                    expect(qValue[1]).equal(queryRes[1]);
                    expect(qEntiyKind).equal('Company');

                    const { args: args2 } = cache.queries.kset.getCall(1);
                    expect(args2[0]).equal(queryKey2);
                    expect(args2[1][0][0]).contains(queryRes2[0][0]);
                    expect(args2[2]).equal('User');
                    expect(result).deep.equal([queryRes, queryRes2]);
                });
            });

            it('should still prime the cache fot "non Redis" stores', () => {
                const queryRes2 = [[{ name: string.random() }], metaQuery];

                cache = new NsqlCache({
                    db: dbAdapter(),
                    stores: [StoreMock(), storeRedis],
                    config: {
                        ttl: {
                            redis: { queries: 0 },
                        },
                        wrapClient: false,
                    },
                });
                sinon.spy(cache, 'primeCache');

                return cache.queries.mset(query1, queryRes, query2, queryRes2).then(() => {
                    expect(cache.primeCache.called).equal(true);

                    const { args } = cache.primeCache.getCall(0);

                    expect(args[0]).equal(queryToString(query1));
                    expect(args[1][0][0]).contains(queryRes[0][0]);
                    expect(args[2].cacheManager).equal(cache.cacheManagerNoRedis);

                    cache.primeCache.restore();
                });
            });
        });
    });

    describe('del()', () => {
        const NsqlCache = requireUncached('../lib');

        beforeEach(() => {
            cache = new NsqlCache({ db: dbAdapter(), config: { wrapClient: false } });
            queryRes = [[{ name: string.random() }], metaQuery];

            sinon.spy(cache, 'del');
            prefix = cache.config.cachePrefix.queries;
            queryToString = query => prefix + cache.db.queryToString(query);
        });

        afterEach(() => {
            cache.del.restore();
        });

        it('should delete 1 query from cache', () =>
            cache.queries.del(query1).then(() => {
                assert.ok(cache.del.called);
                const { args } = cache.del.getCall(0);
                expect(args[0]).deep.equal([queryToString(query1)]);
            }));

        it('should delete multiple queries from cache', () =>
            cache.queries.del(query1, query2, query3).then(() => {
                assert.ok(cache.del.called);
                const { args } = cache.del.getCall(0);
                expect(args[0][0]).deep.equal(queryToString(query1));
                expect(args[0][1]).deep.equal(queryToString(query2));
                expect(args[0][2]).deep.equal(queryToString(query3));
            }));
    });

    describe('kset', () => {
        const NsqlCache = requireUncached('../lib');

        beforeEach(() => {
            cache = new NsqlCache({
                db: dbAdapter(),
                stores: [StoreMock('redis')],
                config: {
                    wrapClient: false,
                },
            });
            queryRes = [[{ name: string.random() }], metaQuery];
            sinon.spy(methods, 'fetchHandler');

            prefix = cache.config.cachePrefix.queries;
            queryToString = query => prefix + cache.db.queryToString(query);
            ({ cacheManager, redisClient } = cache);
        });

        afterEach(() => {
            methods.fetchHandler.restore();
        });

        it('should add queryKey to entityKind Redis set', () => {
            const queryKey = queryToString(query1);
            sinon.spy(redisClient, 'multi');

            return cache.queries.kset(queryKey, queryRes, 'User').then(() => {
                assert.ok(redisClient.multi.called);
                const { args } = redisClient.multi.getCall(0);
                expect(args[0][0]).deep.equal(['sadd', `${prefix}User`, queryKey]);
                expect(args[0][1]).deep.equal(['set', queryKey, JSON.stringify(queryRes)]);

                redisClient.multi.restore();
            });
        });

        it('should allow an unlimited number of entity Kinds for a query', () => {
            const queryKey = queryToString(query1);
            sinon.spy(redisClient, 'multi');

            return cache.queries.kset(queryKey, queryRes, ['User', 'Task', 'Post']).then(() => {
                assert.ok(redisClient.multi.called);
                const { args } = redisClient.multi.getCall(0);
                expect(args[0][0]).deep.equal(['sadd', `${prefix}User`, queryKey]);
                expect(args[0][1]).deep.equal(['sadd', `${prefix}Task`, queryKey]);
                expect(args[0][2]).deep.equal(['sadd', `${prefix}Post`, queryKey]);
                expect(args[0][3]).deep.equal(['set', queryKey, JSON.stringify(queryRes)]);

                redisClient.multi.restore();
            });
        });

        it('should return the response from Redis', () => {
            const response = 'OK';
            redisClient.multi = () => ({
                exec: cb => cb(null, response),
            });

            return cache.queries.kset().then(res => {
                expect(res).equal(response);
            });
        });

        it('should bubble up error', () => {
            const error = new Error('Houston we got a problem');
            sinon.stub(redisClient, 'multi').callsFake(() => ({ exec: cb => cb(error) }));

            return cache.queries.kset().catch(err => {
                expect(err).equal(error);
                redisClient.multi.restore();
            });
        });

        it('should throw an Error if no Redis client', done => {
            cache = new NsqlCache({ db: dbAdapter(), config: { wrapClient: false } });

            cache.queries.kset().catch(err => {
                expect(err.message).equal('No Redis Client found.');
                done();
            });
        });
    });

    describe('clearQueriesEntityKind', () => {
        const NsqlCache = requireUncached('../lib');

        beforeEach(() => {
            cache = new NsqlCache({
                db: dbAdapter(),
                stores: [StoreMock('redis')],
                config: {
                    wrapClient: false,
                },
            });
            queryRes = [[{ name: string.random() }], metaQuery];
            sinon.spy(methods, 'fetchHandler');

            prefix = cache.config.cachePrefix.queries;
            queryToString = query => prefix + cache.db.queryToString(query);
            ({ cacheManager, redisClient } = cache);
        });

        afterEach(() => {
            methods.fetchHandler.restore();
        });

        it('should remove all queries keys from entityKind Set and their cache', () => {
            sinon.stub(redisClient, 'multi').callsFake(() => ({
                exec: cb => cb(null, [['abc', 'def'], null]),
            }));

            sinon.stub(redisClient, 'del').callsFake((keys, cb) => cb(null, 7));

            return cache.queries.clearQueriesEntityKind(['User', 'Posts']).then(res => {
                assert.ok(redisClient.multi.called);
                assert.ok(redisClient.del.called);
                const { args: argsMulti } = redisClient.multi.getCall(0);
                const { args: argsDel } = redisClient.del.getCall(0);

                const setQueries = `${prefix}User`;
                expect(argsMulti[0][0]).deep.equal(['smembers', setQueries]);
                expect(argsDel[0]).include.members(['abc', 'def', setQueries]);
                expect(res).equal(7);

                redisClient.multi.restore();
                redisClient.del.restore();
            });
        });

        it('should bubble up errors from "smembers" call', done => {
            const error = new Error('Houston we really got a problem');
            sinon.stub(redisClient, 'multi').callsFake(() => ({ exec: cb => cb(error) }));

            cache.queries.clearQueriesEntityKind('User').catch(err => {
                expect(err).equal(error);

                redisClient.multi.restore();
                done();
            });
        });

        it('should bubble up errors from "del" call', done => {
            const error = new Error('Houston we really got a problem');
            sinon.stub(redisClient, 'multi').returns({ exec: cb => cb(null, []) });
            sinon.stub(redisClient, 'del').callsFake((key, cb) => {
                cb(error);
            });

            cache.queries.clearQueriesEntityKind('User').catch(err => {
                expect(err).equal(error);
                redisClient.del.restore();
                done();
            });
        });

        it('should resolve with an Error if no Redis client', done => {
            cache = new NsqlCache({ db: dbAdapter(), config: { wrapClient: false } });

            cache.queries.clearQueriesEntityKind('EntiyKind').then(err => {
                expect(err.message).equal('No Redis Client found.');
                expect(err.code).equal('ERR_NO_REDIS');
                done();
            });
        });
    });
});
