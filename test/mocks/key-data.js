'use strict';

const { string } = require('../../lib/utils');

const generateKey = () => ({ name: string.random() });

function Query(kind) {
    this.name = string.random();
    this.kind = kind;

    this.run = () => Promise.resolve();
}

const key1 = generateKey();
const key2 = generateKey();
const key3 = generateKey();
const key4 = generateKey();
const key5 = generateKey();

const entity1 = { name: 'John' };
const entity2 = { name: 'Mick' };
const entity3 = { name: 'Carol' };
const entity4 = { name: 'Greg' };
const entity5 = { name: 'Tito' };

entity1.__key = key1;
entity2.__key = key2;
entity3.__key = key3;
entity4.__key = key4;
entity5.__key = key5;

const query1 = new Query('Company');
const query2 = new Query('User');
const query3 = new Query('Company');

module.exports = {
    keys: [key1, key2, key3, key4, key5],
    entities: [entity1, entity2, entity3, entity4, entity5],
    queries: [query1, query2, query3],
};
