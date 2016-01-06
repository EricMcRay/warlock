var crypto       = require('crypto');
var UUID         = require('uuid');
var fs = require('fs');

module.exports = function(redis){
  var warlock = {};

  var scripty = new Scripty(redis);

  warlock.makeKey = function(key) {
    return key + ':lock';
  };

  /**
   * Set a lock key
   * @param {string}   key    Name for the lock key. String please.
   * @param {integer}  ttl    Time in milliseconds for the lock to live.
   * @param {Function} cb
   */
  warlock.lock = function(key, ttl, cb) {
    cb = cb || function(){};

    if (typeof key !== 'string') {
      return cb(new Error('lock key must be string'));
    }

    var id;
    UUID.v1(null, (id = new Buffer(16)));
    id = id.toString('base64');
    redis.set(
      warlock.makeKey(key), id,
      'PX', ttl, 'NX',
      function(err, lockSet) {
        if (err) return cb(err);

        var unlock = warlock.unlock.bind(warlock, key, id);
        if (!lockSet) unlock = false;

        return cb(err, unlock, id);
      }
    );

    return key;
  };

  warlock.unlock = function(key, id, cb) {
    cb = cb || function(){};

    if (typeof key !== 'string') {
      return cb(new Error('lock key must be string'));
    }

    fs.readFile(__dirname + '/lua/parityDel.lua', 'utf8',
      function(err, lua){
        if (err) return cb(err);
        var data = [lua, 1, key, id];
        redis.script('eval', data, cb);
      }
    );
  };

  /**
   * Set a lock optimistically (retries until reaching maxAttempts).
   */
  warlock.optimistic = function(key, ttl, maxAttempts, wait, cb) {
    var attempts = 0;

    var tryLock = function() {
      attempts += 1;
      warlock.lock(key, ttl, function(err, unlock) {
        if (err) return cb(err);

        if (typeof unlock !== 'function') {
          if (attempts >= maxAttempts) {
            var e = new Error('unable to obtain lock');
            e.maxAttempts = maxAttempts;
            e.key = key;
            e.ttl = ttl;
            e.wait = wait;
            return cb(e);
          }
          return setTimeout(tryLock, wait);
        }

        return cb(err, unlock);
      });
    };

    tryLock();
  };

  return warlock;
};
