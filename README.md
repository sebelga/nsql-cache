<!-- README template from
https://raw.githubusercontent.com/dbader/readme-template/master/README.md
-->

# Nsql Cache [![Tweet](https://img.shields.io/twitter/url/http/shields.io.svg?style=social)](https://twitter.com/intent/tweet?text=Advanced%20cache%20layer%20for%20NoSQL%20databases!%20https%3A%2F%2Fgithub.com%2Fsebelga%2Fnsql-cache)

> Advanced Cache Layer for NoSQL databases

[![NPM Version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]
[![coveralls-image]][coveralls-url]

<img title="logo" src="logo/logo.gif" width="85%" align="center">

[**Installation**](#installation) |
[**API**](#api) |
[**Support**](../../issues)

nsql-cache is an advanced cache layer for NoSQL database clients. It is vendor agnostic and currently has the following database adapters:

- [nsql-cache-datastore](https://github.com/sebelga/nsql-cache-datastore) for the Google Datastore

<!-- See the [Medium article](https://medium.com/p/ffb402cd0e1c/edit) for an in-depth overview of this library. -->

## Highlight

* Have **multiple cache stores** with different TTL thanks to [node-cache-manager](https://github.com/BryanDonovan/node-cache-manager).
* **LRU memory cache** out of the box to speed up your application right away.
* Advanced cache (when using [node_redis](https://github.com/NodeRedis/node_redis)) that automatically saves the queries in Redis _Sets_ by entity **Kind**. You can then have an **infinite TTL** (time to live) for the queries and their cache is invalidated only when an entity of the same _Kind_ is **added**, **updated** or **deleted**.

> Please don’t forget to star this repo if you found it useful :)

## Installation

To create a nsql-cache instance, we need to provide a **database adapter**. In the examples here we will use the Google Datastore adapter.

```sh
npm install nsql-cache nsql-cache-datastore --save
# or
yarn add nsql-cache nsql-cache-datastore
```

## Create a cache instance

```js
// ----------------------------
// Google Datastore example
// ----------------------------
const Datastore = require('@google-cloud/datastore');
const NsqlCache = require('nsql-cache');
const dsAdapter = require('nsql-cache-datastore');

const datastore = new Datastore(); // Google Datastore client
const db = dsAdapter(datastore); // Nsql database adapter
const cache = new NsqlCache({ db }); // Nsql cache instance
```

Great! You now have a LRU memory cache with the following configuration:

- Maximum number of objects in cache: 100
- TTL (time to live) for entities (_Key_ fetch): 10 minutes
- TTL for queries: 5 second

#### Configuration

To change the default TTL you can pass a configuration object when creating the cache instance.

```js
const cache = new NsqlCache({
    db,
    config: {
        ttl: {
            keys: 60 * 10, // 10 minutes (default)
            queries: 5, // 5 seconds (default)
        }
    }
});
```

For the complete configuration options, please refer to the [API documentation](#api) below.

### Wrap database client

By default, _if_ the database adapter supports it, nsql-cache will wrap the database client in order to fully manage the cache for you.  
If you don't want the database client to be wrapped, disable it in the configuration.  You are then responsible to manage the cache.  Look at the examples in the [nsql-cache-datastore](https://github.com/sebelga/nsql-cache-datastore#advanced-usage-cache-not-managed) repository to see how to manage the cache yourself.

```js
const cache = new NsqlCache({
    db,
    config: {
        ...
        wrapClient: false,
    }
});
```

### Core concepts

nsql-cache is based on the core concepts of NoSQL database data agregation. As there are no JOIN operation expanding over multiple tables, the only two ways to fetch entities are:
- by **Key(s)** - the fastest way to retrieve entity(ies) from the database
- by **Query** - on a single entity _type_. ex: `SELECT * from Posts (type) FILTER type=tech`


#### Queries

As you might have noticed in the default configuration above, queries have a very short TTL (5 seconds). This is because as soon as we create, update or delete an entity, any query that we have cached might be out of sync.  
Depending on the use cases, 5 seconds might be acceptable or not. Remember that you can always disable the cache or lower the TTL on specific queries. You might also decide that you never want the queries to be cached, in such case set the global TTL value for queries to **-1**. 
But there is a better way: providing a **_Redis_ client**.

#### Multi cache stores

nsql-cache uses the [node-cache-manager](https://github.com/BryanDonovan/node-cache-manager) library to handle the cache. This means that you can have **multiple cache store** with different TTL on each one. The most interesting one for us is the `cache-manager-redis-store` as it is a Redis client that supports `mget()` and  `mset()` which is what we need for our _batch_ operations (get, save, delete multiple keys).  

First, add the dependency to your package.json

```sh
npm install cache-manager-redis-store --save
# or
yarn add cache-manager-redis-store
```

Then provide the cache store to the nsql-cache constructor.

```js
...
const redisStore = require('cache-manager-redis-store');

const cache = new NsqlCache({
    db,
    stores: [
        {
            store: 'memory',
            max: 100, // maximum number of obects
        },
        {
            store: redisStore,
            host: 'localhost', // default value
            port: 6379, // default value
            auth_pass: 'xxxx'
        }
    ]
})
```

We now have _two_ cache stores with different TTL values in each one.  

- memory store: ttl keys = 5 minutes, ttl queries = 5 seconds
- redis store: ttl keys = 1 day, ttl queries = **infinite** (0)

> If you only wants the Redis cache, remove the memory store from the array.

Infinite cache for queries? Yes! nsql-cache keeps a reference of each query by Entity _Kind_ in a Redis _**Set**_ so it can **invalidate the cache** when an entity of the same _Kind_ is added, updated or deleted.
<!-- For more information on this read the [Medium article](https://medium.com/p/ffb402cd0e1c/edit). -->

You can of course change the default TTL for each store:

```js
...

const cache = new NsqlCache({
    db,
    stores: [
        { store: 'memory' },
        { store: redisStore }
    ],
    config: {
        ttl: {
            memory: {
                keys: 60 * 60, // 1 hour
                queries: 30 // 30 seconds
            },
            redis: {
                keys: 60 * 60 * 48,
                queries: 60 * 60 * 24
            },
        }
    }
})
```

---

## API

### NsqlCache Instantiation

#### `new NsqlCache(options)`

* _options_: An object with the following properties:

    * **db**: a database adapter (the doc will come soon on how to create your own)
    * **stores**: an Array of _cache-manager_ stores stores (optional)
    * **config**: an object of configuration (optional)

Note on stores: Each store is an object that will be passed to the `cacheManager.caching()` method. [Read the docs](https://github.com/BryanDonovan/node-cache-manager) to learn more about node cache manager.  

  **Important:** Since version 2.7.0, cache-manager supports `mset()`, `mget()` and `del()` for **multiple keys** batch operation. The store(s) you provide here must support this feature.  
  At the time of this writting only the "memory" store and the "[node-cache-manager-redis-store](https://github.com/dabroek/node-cache-manager-redis-store)" support it.  
  If you provide a store that does not support mset/mget you can still use nsql-cache but you won't be able to set or retrieve multiple keys/queries in batch.


The **config** object has the following properties (showing _default_ values):

```js
const config = {
    ttl: {
        keys: 60 * 10, // 10 minutes
        queries: 5, // 5 seconds

        // *only* for multiple store, pass the name of the store
        // and values for TTL keys/queries
        memory: {
            keys: 60 * 10,
            queries: 5,
        },
        redis: {
            keys: 60 * 60 * 24,
            queries: 0, // infinite
        },
    },

    // prefix for the keys generated for the cache
    cachePrefix: {
        keys: 'gck:',
        queries: 'gcq:',
    },

    // wrap or not the database client (must be supported by the database adapter)
    wrapClient: true,

    // hash the stringified cache keys
    hashCacheKeys: true,

    // global is **only** for client that have been wrapped. It turns "ON" the cache globally
    // If you set it to false, you will need to pass an option object to each
    // request to activate the cache. --> { cache: true }
    global: true,
};
```

---

### cache.keys

#### `read(key|Array<key> [, options, fetchHandler]])`

Helper that will:
- check the cache
- if no entity(ies) are found in the cache, fetch the entity(ies) in the database
- prime the cache with the entity(ies) data

##### Arguments

* _key_: a entity Key or an Array of entity Keys. If it is an array of keys, only the keys that are **not found in the cache** will be passed to the fetchHandler.

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}

// For multi-stores it can also be an object
{
    ttl: {  memory: 300, redis: 3600 }
}
```

* _fetchHandler_: an optional function handler to fetch the keys. If it is not provided it will default to the database adapter `getEntity(keys)` method.

```js
const { datastore, cache } = require('./db');

const key = datastore.key(['Company', 'Google']);

/**
 * 1. Basic example (using the default fetch handler)
 */
cache.keys.read(key)
    .then(entity => console.log(entity));

/**
 * 2. Example with a custom fetch handler that first gets the key from the Datastore,
 * then runs a query and add the entities from the response to the fetched entity.
 */
const fetchHandler = (key) => (
    datastore.get(key)
        .then((company) => {
            // Add the latest Posts of the company.
            // Don't forget to invalidate the Posts queries cache
            // when creating new Posts entities!
            const query = datastore.createQuery('Posts')
                .filter('companyId', key.id)
                .limit(10);

            return cache.queries.get(query)
                .then(response => {
                    company.posts = response[0];

                    // This is the data that will be saved in the cache
                    return company;
                });
        });
);

// Pass our custom fetchHandler to the read() method
cache.keys.read(key, fetchHandler)
    .then((entity) => {
        console.log(entity);
    });

// --> with a custom TTL duration
cache.keys.read(key, { ttl: 900 }, fetchHandler)
    .then((entity) => {
        console.log(entity);
    });
```

#### `get(key)`

Retrieve an entity from the cache passing a database Key object

```js
const key = datastore.key(['Company', 'Google']);

cache.keys.get(key).then(entity => {
    console.log(entity);
});
```

#### `mget(key [, key2, key3, ...])`

Retrieve multiple entities from the cache.

```js
const key1 = datastore.key(['Company', 'Google']);
const key2 = datastore.key(['Company', 'Twitter']);

cache.keys.mget(key1, key2).then(entities => {
    console.log(entities[0]);
    console.log(entities[1]);
});
```

#### `set(key, entity [, options])`

Add an entity in the cache.

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}

// For multi-stores it can also be an object
{
    ttl: {  memory: 300, redis: 3600 }
}
```

```js
const key = datastore.key(['Company', 'Google']);

datastore.get(key).then(response => {
    cache.keys.set(key, response[0]).then(() => {
        // ....
    });
});
```

#### `mset(key, entity [, key(n), entity(n), options])`

Add multiple entities in the cache.

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}

// For multi-stores it can also be an object
{
    ttl: {  memory: 300, redis: 3600 }
}
```

```js
const key1 = datastore.key(['Company', 'Google']);
const key2 = datastore.key(['Company', 'Twitter']);

datastore.get([key1, key2]).then(response => {
    const [entities] = response;

    // warning: the datastore.get() method (passing multiple keys) does not guarantee
    // the order of the returned entities. You will need to add some logic to sort
    // the response or use the "read" helper above that does it for you.

    cache.keys.mset(key1, entities[0], key2, entities[1], { ttl: 240 }).then(() => ...);
});
```

#### `del(key [, key2, key3, ...])`

Delete one or multiple keys from the cache

```js
const key1 = datastore.key(['Company', 'Google']);
const key2 = datastore.key(['Company', 'Twitter']);

// Single key
cache.keys.del(key1).then(() => { ... });

// Multiple keys
cache.keys.del(key1, key2).then(() => { ... });
```

---

### cache.queries

#### `read(query [, options, fetchHandler])`

Helper that will:

- check the cache
- if the query is not found in the cache, run the query on the database.
- prime the cache with the response of the Query.

#### Arguments

* _query_: a database Query object.

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}

// For multi-stores it can also be an object
{
    ttl: {  memory: 300, redis: 3600 }
}
```

* _fetchHandler_: an optional function handler to fetch the query. If it is not provided it will default to the database adapter `runQuery(query)` method.

```js
const { datastore, cache } = require('./db');

const query = datastore
    .createQuery('Post')
    .filter('category', 'tech')
    .order('updatedOn')
    .limit(10);

/**
 * 1. Basic example (using the default fetch handler)
 */
cache.queries.read(query)
    .then(response => console.log(response[0]));

/**
 * 2. Example with a custom fetch handler.
 */
const fetchHandler = (q) => (
    q.run()
        .then((response) => {
            const [entities, meta] = response;
            // ... do anything with the entities

            // return the complete response (both entities + query meta) to the cache
            return [entities, meta];
        });
);

cache.queries.read(query, fetchHandler)
    .then((response) => {
        console.log(response[0]);
        console.log(response[1].moreResults);
    });
```

#### `get(query)`

Retrieve a query from the cache passing a Query object

```js
const query = datastore.createQuery('Post').filter('category', 'tech');

cache.queries.get(query).then(response => {
    console.log(response[0]);
});
```

#### `mget(query [, query2, query3, ...])`

Retrieve multiple queries from the cache.

```js
const query1 = datastore.createQuery('Post').filter('category', 'tech');
const query2 = datastore.createQuery('User').filter('score', '>', 1000);

cache.queries.mget(query1, query2).then(response => {
    console.log(response[0]); // response from query1
    console.log(response[1]); // response from query2
});
```

#### `set(query, data [, options])`

Add a query in the cache

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}

// For multi-stores it can also be an object
{
    ttl: {  memory: 300, redis: 3600 }
}
```

```js
const query = datastore.createQuery('Post').filter('category', 'tech');

query.run().then(response => {
    cache.queries.set(query, response).then(response => {
        console.log(response[0]);
    });
});
```

#### `mset(query, data [, query(n), data(n), options])`

Add multiple queries in the cache.

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}

// For multi-stores it can also be an object
{
    ttl: {  memory: 300, redis: 3600 }
}
```

```js
const query1 = datastore.createQuery('Post').filter('category', 'tech');
const query2 = datastore.createQuery('User').filter('score', '>', 1000);

Promise.all([query1.run(), query2.run()])
    .then(result => {
        cache.queries.mset(query1, result[0], query2, result[1], { ttl: 900 })
            .then(() => ...);
    });
```

#### `kset(key, value, entityKind|Array<EntityKind> [, options])`

**Important:** this method is only available if you have provided a _Redis_ cache store during initialization.

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}
```

If you have a complex data resulting from several queries and targeting one or multiple Entiy Kind, you can cache it and _link_ the Entity Kind(s) to it. Let's see it in an example:

```js
const { datastore, cache } = require('./db');

/**
 * Handler to fetch all the data for our Home Page
 */
const fetchHomeData = () => {
    // Check the cache first...
    cache.get('website:home').then(data => {
        if (data) {
            // in cache, great!
            return data;
        }

        // Cache not found, query the data
        const queryPosts = datastore
            .createQuery('Posts')
            .filter('category', 'tech')
            .limit(10)
            .order('publishedOn', { descending: true });

        const queryTopStories = datastore
            .createQuery('Posts')
            .order('score', { descending: true })
            .limit(3);

        const queryProducts = datastore.createQuery('Products').filter('featured', true);

        return Promise.all([queryPosts.run(), queryTopStories.run(), queryProducts.run()]).then(result => {
            // Build our data object
            const homeData = {
                posts: result[0],
                topStories: result[1],
                products: result[2],
            };

            // We save the result of the 3 queries to the cache ("website:home" key)
            // and link the data to the "Posts" and "Products" Entity Kinds.
            // We can now safely keep the cache infinitely until we add/edit or delete a "Posts" or a "Products".
            return cache.queries.kset('website:home', homeData, ['Posts', 'Products']);
        });
    });
};
```

#### `clearQueriesByKind(entityKind|Array<EntityKind>)`

Delete all the queries _linked_ to one or several Entity Kinds.

```js
const key = datastore.key(['Posts']);
const data = { title: 'My new post', text: 'Body text of the post' };

datastore.save({ key, data })
    .then(() => {
        // Invalidate all the queries linked to "Posts" Entity Kinds.
        cache.queries.clearQueriesByKind(['Posts'])
            .then(() => {
                ...
            });
    });
```

#### `del(query [, query2, query3, ...])`

Delete one or multiple queries from the cache

```js
const query1 = datastore.createQuery('Post').filter('category', 'tech');
const query2 = datastore.createQuery('User').filter('score', '>', 1000);

// Single query
cache.queries.del(query1).then(() => { ... });

// Multiple queries
cache.queries.del(query1, query2).then(() => { ... });
```

---

### "cache-manager" methods bindings (get, mget, set, mset, del, reset)

nsql-cache has bindings set to the underlying "cache-manager" methods _get_, _mget_, _set_, _mset_, _del_ and _reset_. This allows you to cache any other data. Refer to [the cache-manager documentation](https://github.com/BryanDonovan/node-cache-manager).

```js
const { cache } = require('./db');

cache.set('my-key', { data: 123 }).then(() => ...);

cache.get('my-key').then((data) => console.log(data));

cache.mset('my-key1', true, 'my-key2', 123, { ttl: 60 }).then(() => ...);

cache.mget('my-key1', 'my-key2').then((data) => {
    const [data1, data2] = data;
});

cache.del(['my-key1', 'my-key2']).then(() => ...);

// Clears the cache
cache.reset().then(() => ...);
```

## Development setup

Install the dependencies and run the tests. gstore-caches lints the code with [eslint](https://eslint.org/) and formats it with [prettier](https://prettier.io/) so make sure you have both pluggins installed in your IDE.

```sh
# Run the tests
npm install
npm test

# Coverage
npm run coverage

# Format the code (if you don't use the IDE pluggin)
npm run prettier
```

## Release History

* 1.0.0
    * First Release

## Meta

Sébastien Loix – [@sebloix](https://twitter.com/sebloix)

Distributed under the MIT license. See `LICENSE` for more information.

[https://github.com/sebelga](https://github.com/sebelga/)  

## Contributing

1. Fork it (<https://github.com/sebelga/nsql-cache/fork>)
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Commit your changes (`git commit -am 'Add some fooBar'`)
4. Push to the branch (`git push origin feature/fooBar`)
5. Rebase your feature branch and squash (`git rebase -i master`)
6. Create a new Pull Request

<!-- Markdown link & img dfn's -->

[npm-image]: https://img.shields.io/npm/v/nsql-cache.svg?style=flat-square
[npm-url]: https://npmjs.org/package/nsql-cache
[travis-image]: https://img.shields.io/travis/sebelga/nsql-cache/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/sebelga/nsql-cache
[coveralls-image]: https://img.shields.io/coveralls/github/sebelga/nsql-cache.svg
[coveralls-url]: https://coveralls.io/github/sebelga/nsql-cache?branch=master
