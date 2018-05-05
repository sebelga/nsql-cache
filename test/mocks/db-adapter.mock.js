'use strict';

const data1 = { a: 123 };

module.exports = () => ({
    getEntity() {
        return Promise.resolve(data1);
    },
    getKeyFromEntity(entity) {
        return entity.__key;
    },
    getEntityKindFromQuery(query) {
        return query.kind;
    },
    addKeyToEntity(key, entity) {
        if (!entity) {
            return entity;
        }
        return Object.assign({}, entity, { __key: key });
    },
    keyToString(key) {
        return key.name;
    },
    queryToString(query) {
        return query.name;
    },
    runQuery(query) {
        return query.run();
    },
    wrapClient() {},
});
