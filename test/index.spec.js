/* eslint-disable import/no-extraneous-dependencies */

'use strict';

const chai = require('chai');
const sinon = require('sinon');
const nodeCacheManager = require('cache-manager');

const NsqlCache = require('../lib');
const StoreMock = require('./mocks/cache-store');
const dbAdapter = require('./mocks/db-adapter.mock');

const { expect, assert } = chai;

describe('NsqlCache', () => {
    let cache;

    describe('init()', () => {
        it('should override the default config', () => {
            cache = new NsqlCache({ db: dbAdapter() });

            const { config } = cache;
            expect(config.ttl.keys).equal(600);
            expect(config.ttl.queries).equal(5);
            expect(config.cachePrefix).deep.equal({ keys: 'gck:', queries: 'gcq:' });

            cache = new NsqlCache({
                db: dbAdapter(),
                stores: [
                    {
                        store: 'memory',
                        max: 200,
                    },
                ],
                config: {
                    ttl: {
                        keys: 30,
                        queries: 30,
                    },
                    global: false,
                    cachePrefix: { keys: 'customk:', queries: 'customq:' },
                },
            });

            const newConfig = cache.config;

            expect(newConfig.ttl.keys).equal(30);
            expect(newConfig.ttl.queries).equal(30);
            expect(newConfig.global).equal(false);
            expect(newConfig.cachePrefix).deep.equal({ keys: 'customk:', queries: 'customq:' });
        });

        it('should detect redis client', () => {
            const redisCache = StoreMock('redis');

            cache = new NsqlCache({
                db: dbAdapter(),
                stores: [redisCache],
                config: {
                    ttl: {
                        keys: 30,
                        queries: 30,
                    },
                },
            });

            assert.isDefined(cache.redisClient);
        });

        it('should detect redis client (multi store)', () => {
            sinon.stub(nodeCacheManager, 'caching').callsFake(store => StoreMock(store));

            cache = new NsqlCache({
                db: dbAdapter(),
                stores: ['memory', 'redis'],
                config: {
                    ttl: {
                        keys: 30,
                        queries: 30,
                    },
                },
            });

            assert.isDefined(cache.redisClient);
            nodeCacheManager.caching.restore();
        });

        it('should throw an error if no db passed', () => {
            const func = () => {
                cache = new NsqlCache();
            };
            expect(func).throws('No valid Database adapter provided.');
        });

        it('should set "getKeyFromEntity" and "addKeyToEntity" method on db', () => {
            const db = dbAdapter();
            delete db.getKeyFromEntity;
            delete db.addKeyToEntity;

            assert.isUndefined(db.getKeyFromEntity);
            assert.isUndefined(db.addKeyToEntity);
            cache = new NsqlCache({ db });

            expect(db.getKeyFromEntity()).equal(null);
            const e = {};
            expect(db.addKeyToEntity({ id: 123 }, e)).equal(e);
        });
    });

    describe('primeCache()', () => {
        let cacheManager;
        beforeEach(() => {
            cache = new NsqlCache({ db: dbAdapter() });
            ({ cacheManager } = cache);
        });

        it('should concatenate key|value pairs and return single value', () => {
            sinon.stub(cacheManager, 'mset').resolves(['Mick Jagger']);

            return cache.primeCache('user123', 'Mick Jagger').then(response => {
                expect(response).equal('Mick Jagger');
                cacheManager.mset.restore();
            });
        });

        it('should concatenate key|value pairs and return multiple value', () => {
            sinon.stub(cacheManager, 'mset').resolves(['Mick Jagger', 'John Snow']);

            return cache.primeCache(['user123'], ['john snow']).then(response => {
                expect(response[0]).equal('Mick Jagger');
                expect(response[1]).equal('John Snow');
            });
        });

        it('should maintain value as Array', () => {
            sinon.stub(cacheManager, 'mset').resolves(['Mick Jagger']);

            return cache.primeCache('user123', ['Mick Jagger']).then(() => {
                const { args } = cacheManager.mset.getCall(0);
                assert.ok(Array.isArray(args[1]));
                expect(args[1][0]).equal('Mick Jagger');
                cacheManager.mset.restore();
            });
        });
    });

    describe('getCacheManager()', () => {
        it('should return the cache manager', () => {
            cache = new NsqlCache({ db: dbAdapter() });
            assert.isDefined(cache.cacheManager);
        });
    });

    describe('get|mget|set|mset|del|reset', () => {
        it('should bind to cache-manager methods', () => {
            cache = new NsqlCache({ db: dbAdapter() });
            const { cacheManager } = cache;

            expect(cache.get).equal(cacheManager.get);
            expect(cache.mget).equal(cacheManager.mget);
            expect(cache.set).equal(cacheManager.set);
            expect(cache.mset).equal(cacheManager.mset);
            expect(cache.del).equal(cacheManager.del);
            expect(cache.reset).equal(cacheManager.reset);
        });
    });
});
