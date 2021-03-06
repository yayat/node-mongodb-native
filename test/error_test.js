var mongodb = process.env['TEST_NATIVE'] != null ? require('../lib/mongodb').native() : require('../lib/mongodb').pure();
var useSSL = process.env['USE_SSL'] != null ? true : false;

var testCase = require('nodeunit').testCase,
  debug = require('util').debug,
  inspect = require('util').inspect,
  nodeunit = require('nodeunit'),
  gleak = require('../dev/tools/gleak'),
  Db = mongodb.Db,
  Cursor = mongodb.Cursor,
  Collection = mongodb.Collection,
  Server = mongodb.Server;

var MONGODB = 'integration_tests';
var client = null;

/**
 * Retrieve the server information for the current
 * instance of the db client
 * 
 * @ignore
 */
exports.setUp = function(callback) {
  var self = exports;  
  client = new Db(MONGODB, new Server("127.0.0.1", 27017, {auto_reconnect: true, poolSize: 4, ssl:useSSL}), {w:0, native_parser: (process.env['TEST_NATIVE'] != null)});
  client.open(function(err, db_p) {
    if(numberOfTestsRun == (Object.keys(self).length)) {
      // If first test drop the db
      client.dropDatabase(function(err, done) {
        callback();
      });
    } else {
      return callback();
    }
  });
}

/**
 * Retrieve the server information for the current
 * instance of the db client
 * 
 * @ignore
 */
exports.tearDown = function(callback) {
  var self = this;
  numberOfTestsRun = numberOfTestsRun - 1;
  // Close connection
  client.close();
  callback();
}

// Test the error reporting functionality
exports.shouldCorrectlyRetrieveErrorMessagesFromServer = function(test) {    
  // Just run with one connection in the pool
  var error_client = new Db(MONGODB, new Server("127.0.0.1", 27017, {auto_reconnect: false, poolSize:1, ssl:useSSL}), {w:0, native_parser: (process.env['TEST_NATIVE'] != null)});
  // Open the db
  error_client.open(function(err, error_client) {
    error_client.resetErrorHistory(function() {
      error_client.error(function(err, documents) {
        test.equal(true, documents[0].ok);
        test.equal(0, documents[0].n);

        // Force error on server
        error_client.executeDbCommand({forceerror: 1}, function(err, r) {
          test.equal(0, r.documents[0].ok);
          test.ok(r.documents[0].errmsg.length > 0);
          // Check for previous errors
          error_client.previousErrors(function(err, documents) {
            test.equal(true, documents[0].ok);
            test.equal(1, documents[0].nPrev);
            test.equal("forced error", documents[0].err);

            // Check for the last error
            error_client.error(function(err, documents) {
              test.equal("forced error", documents[0].err);
              // Force another error
              error_client.collection('test_error_collection', function(err, collection) {
                collection.findOne({name:"Fred"}, function(err, document) {
                  // Check that we have two previous errors
                  error_client.previousErrors(function(err, documents) {
                    test.equal(true, documents[0].ok);
                    test.equal(2, documents[0].nPrev);
                    test.equal("forced error", documents[0].err);

                    error_client.resetErrorHistory(function() {
                      error_client.previousErrors(function(err, documents) {
                        test.equal(true, documents[0].ok);
                        test.equal(-1, documents[0].nPrev);

                        error_client.error(function(err, documents) {                            
                          test.equal(true, documents[0].ok);
                          test.equal(0, documents[0].n);

                          // Let's close the db
                          error_client.close();

                          error_client.error(function(err, documents) {
                            test.ok(err instanceof Error);
                            test.equal('no open connections', err.message);
                            test.done();
                          });
                        });
                      })
                    });
                  });
                });
              });
            })
          });
        });
      });
    });
  });    
}

// Test the last status functionality of the driver
exports.shouldCorrectlyExecuteLastStatus = function(test) {
  // Just run with one connection in the pool
  var error_client = new Db(MONGODB, new Server("127.0.0.1", 27017, {auto_reconnect: false, poolSize:1, ssl:useSSL}), {w:0, native_parser: (process.env['TEST_NATIVE'] != null)});
  // Open the db
  error_client.open(function(err, client) {
    client.createCollection('test_last_status', function(err, collection) {
      test.ok(collection instanceof Collection);
      test.equal('test_last_status', collection.collectionName);

      // Get the collection
      client.collection('test_last_status', function(err, collection) {
        // Remove all the elements of the collection
        collection.remove(function(err, result) {          
          // Check update of a document
          collection.insert({i:1}, function(err, ids) {
            test.equal(1, ids.length);
            test.ok(ids[0]._id.toHexString().length == 24);

            // Update the record
            collection.update({i:1}, {"$set":{i:2}}, function(err, result) {
              // Check for the last message from the server
              client.lastStatus(function(err, status) {
                test.equal(true, status[0].ok);
                test.equal(true, status[0].updatedExisting);
                // Check for failed update of document
                collection.update({i:1}, {"$set":{i:500}}, function(err, result) {
                  client.lastStatus(function(err, status) {
                    test.equal(true, status[0].ok);
                    test.equal(false, status[0].updatedExisting);

                    // Check safe update of a document
                    collection.insert({x:1}, function(err, ids) {
                      collection.update({x:1}, {"$set":{x:2}}, {'safe':true}, function(err, document) {
                      });
                    
                      collection.update({x:1}, {"$set":{x:2}});

                      collection.update({y:1}, {"$set":{y:2}}, {'safe':true}, function(err, result) {
                        test.equal(0, result);

                        // Let's close the db
                        error_client.close();
                        // Let's close the db
                        test.done();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });    
  });
}

exports.shouldFailInsertDueToUniqueIndex = function(test) {
  client.createCollection('test_failing_insert_due_to_unique_index', function(err, r) {
    client.collection('test_failing_insert_due_to_unique_index', function(err, collection) {
      collection.ensureIndex([['a', 1 ]], {unique:true, w:1}, function(err, indexName) {
        collection.insert({a:2}, {safe: true}, function(err, r) {
          test.ok(err == null);
          collection.insert({a:2}, {safe: true}, function(err, r) {
            test.ok(err != null);
            test.done();
          })
        })
      })
    })
  })    
}

// Test the error reporting functionality
exports.shouldFailInsertDueToUniqueIndexStrict = function(test) {
  var error_client = new Db(MONGODB, new Server("127.0.0.1", 27017, {auto_reconnect: false, ssl:useSSL}), {w:0, native_parser: (process.env['TEST_NATIVE'] != null)});
  error_client.open(function(err, error_client) {
    error_client.dropCollection('test_failing_insert_due_to_unique_index_strict', function(err, r) {
      error_client.createCollection('test_failing_insert_due_to_unique_index_strict', function(err, r) {
        error_client.collection('test_failing_insert_due_to_unique_index_strict', function(err, collection) {
          collection.ensureIndex([['a', 1 ]], {unique:true, w:1}, function(err, indexName) {
            collection.insert({a:2}, {w:1}, function(err, r) {
              test.ok(err == null);
              collection.insert({a:2}, {w:1}, function(err, r) {
                test.ok(err != null);
                error_client.close();
                test.done();
              })
            })
          })
        })
      })
    });
  });
}

exports['safe mode should pass the disconnected error to the callback'] = function (test) {
  var error_client = new Db(MONGODB, new Server("127.0.0.1", 27017, {auto_reconnect: false, ssl:useSSL}), {w:0, native_parser: (process.env['TEST_NATIVE'] != null)});
  var name = 'test_safe_mode_when_disconnected';
  error_client.open(function(err, error_client) {
    test.ok(err == null);
    error_client.resetErrorHistory(function() {
      error_client.dropCollection(name, function() {
        error_client.createCollection(name, function(err, collection) {
          test.ok(err == null);
          collection.insert({ inserted: true }, { safe: true }, function (err) {
            test.ok(err == null);
            error_client.close();

            collection.insert({ works: true }, { safe: true }, function (err) {
              test.ok(err instanceof Error);
              test.equal('no open connections', err.message);

              collection.update({ inserted: true }, { inserted: true, x: 1 }, { safe: true }, function (err) {
                test.ok(err instanceof Error);
                test.equal('no open connections', err.message);

                collection.remove({ inserted: true }, { safe: true }, function (err) {
                  test.ok(err instanceof Error);
                  test.equal('no open connections', err.message);

                  collection.findOne({ works: true }, function (err) {
                    test.ok(err instanceof Error);
                    test.equal('no open connections', err.message);
                    test.done();
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

exports.shouldHandleAssertionError = function(test) {
  client.createCollection('test_handle_assertion_error', function(err, r) {
    client.collection('test_handle_assertion_error', function(err, collection) {
      collection.insert({a:{lat:50, lng:10}}, {safe: true}, function(err, docs) {
        test.ok(err == null);

        var query = {a:{$within:{$box:[[1,-10],[80,120]]}}};

        // We don't have a geospatial index at this point
        collection.findOne(query, function(err, docs) {
          test.ok(err instanceof Error);
          
          collection.ensureIndex([['a', '2d' ]], {unique:true, w:1}, function(err, indexName) {
            test.ok(err == null);
            
            collection.findOne(query, function(err, doc) {
              test.ok(err == null);
              
              var invalidQuery = {a:{$within:{$box:[[-10,-180],[10,180]]}}};

              client.admin().serverInfo(function(err, result){
                collection.findOne(invalidQuery, function(err, doc) {
                  if(parseInt((result.version.replace(/\./g, ''))) < 200) {
                    test.ok(err instanceof Error);
                  } else {                        
                    test.equal(null, err);
                    test.equal(null, doc);
                  }

                  test.done();
                });  
              });
            });
          });
        });          
      });
    });
  }); 
}

exports['mixing included and excluded fields should return an error object with message'] = function (test) {
  client.createCollection('test_error_object_should_include_message', function(err, c) {
    test.equal(err, null);
    c.insert({a:2, b: 5}, {w:1}, function(err, r) {
      test.equal(err, null);
      c.findOne({a:2}, {fields: {a:1, b:0}}, function(err) {
        test.ok(err);
        test.equal('object', typeof err);
        var rgx = /You cannot currently mix including and excluding fields/;
        test.ok(rgx.test(err.message), 'missing error message property');
        test.done();
      });
    });
  });
}
  
/**
 * Retrieve the server information for the current
 * instance of the db client
 * 
 * @ignore
 */
exports.noGlobalsLeaked = function(test) {
  var leaks = gleak.detectNew();
  test.equal(0, leaks.length, "global var leak detected: " + leaks.join(', '));
  test.done();
}

/**
 * Retrieve the server information for the current
 * instance of the db client
 * 
 * @ignore
 */
var numberOfTestsRun = Object.keys(this).length - 2;
