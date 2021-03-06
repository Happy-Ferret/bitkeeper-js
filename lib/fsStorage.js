'use strict'

var Q = require('q')
var fs = require('fs')
var walk = require('walk')
var rimraf = Q.nfbind(require('rimraf'))
var mkdirp = require('mkdirp')
var path = require('path')
var readFile = Q.nfbind(fs.readFile)
var writeFile = Q.nfbind(fs.writeFile)
var unlink = Q.nfbind(fs.unlink)
var debug = require('debug')('fsStorage')

function Storage (folder) {
  this._folder = folder
  this._pending = []
}

Storage.prototype.getOne = function (key) {
  return readFile(this.getAbsPathForKey(key))
}

Storage.prototype.exists = function (key) {
  var filePath = this.getAbsPathForKey(key)
  return Q.Promise(function (resolve) {
    fs.exists(filePath, resolve)
  })
}

Storage.prototype.getAbsPathForKey = function (key) {
  return path.join(this._folder, key.slice(0, 2), key.slice(2))
}

Storage.prototype.getMany = function (keys) {
  var self = this

  var tasks = keys.map(function (k) {
    return self.getOne(k)
  })

  return Q.allSettled(tasks)
    .then(function (results) {
      return results.map(function (r) {
        return r.value
      })
    })
}

Storage.prototype.getAll = function () {
  return getFilesRecursive(this._folder).then(function (files) {
    return Q.all(files.map(function (f) {
      return readFile(f)
    }))
  })
}

Storage.prototype.putOne = function (key, value) {
  var self = this

  if (this._closed) return Q.reject('storage is closed')

  var promise = this.exists(key)
    .then(function (exists) {
      if (exists) {
        throw new Error('value for this key already exists in storage')
      }

      return self._save(key, value)
    })
    .finally(function (result) {
      self._pending.splice(self._pending.indexOf(promise), 1)
      return result
    })

  this._pending.push(promise)
  return promise
}

Storage.prototype._save = function (key, val) {
  var filePath = this.getAbsPathForKey(key)
  var dir = path.dirname(filePath)
  var exists
  return this.exists(key)
    .then(function (_exists) {
      exists = _exists
      return Q.nfcall(mkdirp, dir)
    })
    .then(function () {
      return writeFile(filePath, val)
    })
    .then(function () {
      return !exists
    })
}

Storage.prototype.removeOne = function (key) {
  return unlink(this.getAbsPathForKey(key))
}

Storage.prototype.clear = function () {
  return rimraf(this._folder)
}

Storage.prototype.close = function () {
  this._closed = true
  return Q.allSettled([this._pending])
}

function getFilesRecursive (dir) {
  var deferred = Q.defer()
  var files = []
  // Walker options
  var walker = walk.walk(dir, {
    followLinks: false
  })
  walker.on('file', function (root, stat, next) {
    // Add this file to the list of files
    files.push(root + '/' + stat.name)
    next()
  })

  walker.on('errors', function (root, nodeStatsArray, next) {
    debug('failed to read file', nodeStatsArray)
    next()
  })

  walker.on('end', function () {
    deferred.resolve(files)
  })

  return deferred.promise
}

module.exports = Storage
