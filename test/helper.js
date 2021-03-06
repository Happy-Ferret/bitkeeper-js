var net = require('net')
var Q = require('q')
var Keeper = require('../')
var baseConfig = require('../conf/config')
var DHT = require('bittorrent-dht/client')
// var ports = require('promise-ports')
baseConfig.storage = false

var common = require('../lib/common')

module.exports = {
  createDHTs: createDHTs,
  createKeepers: createKeepers,
  startInSeries: startInSeries,
  friendNext: friendNext,
  friendFirst: friendFirst,
  befriend: befriend
}

function createDHTs (numInstances) {
  var dhts = []

  for (var i = 0; i < numInstances; i++) {
    dhts.push(new DHT({
      bootstrap: false
    }))
  }

  var tasks = dhts.map(function (dht, idx) {
    return Q.Promise(function (resolve) {
      dht.listen(baseConfig.dhtPort + 50000 + idx, resolve)
      dht.socket.unref()
    })
  })

  return Q.all(tasks)
    .then(function () {
      return dhts
    })
}

function createKeepers (numInstances, mapPorts) {
  var dhts
  var configs
  return createDHTs(numInstances)
    .then(function (_dhts) {
      dhts = _dhts

      configs = dhts.map(function (dht, i) {
        var kConfig = common.clone(baseConfig)
        kConfig.dhtPort = dht.address().port
        if (baseConfig.torrentPort) {
          kConfig.torrentPort = baseConfig.torrentPort + i
        } else {
          if (!net.isUTP) {
            kConfig.torrentPort = kConfig.dhtPort + 1000
          }
        }

        kConfig.dht = dht
        return kConfig
      })

      if (mapPorts) throw new Error('no longer supported')

      // var portConfigs = []
      // configs.forEach(function (conf) {
      //   portConfigs.push({
      //     public: conf.torrentPort,
      //     private: conf.torrentPort,
      //     hijack: true
      //   }, {
      //     public: conf.dhtPort,
      //     private: conf.dhtPort,
      //     hijack: true
      //   })
      // })

      // return ports.mapPorts.apply(ports, portConfigs)
    })
    .then(function () {
      return startInSeries(configs)
    })
}

function startInSeries (configs) {
  return configs.reduce(function (promise, config) {
    return promise.then(function (keepers) {
      return Q.Promise(function (resolve, reject) {
        var k = new Keeper(config)
        k.on('ready', function () {
          keepers.push(k)
          resolve(keepers)
        })

        k.on('error', reject)
      })
    })
  }, Q.all([]))
}

/**
 *  Everyone friends the guy in front of them
 *  This should guarantee that anyone can find anyone else (with enough queries)
 */
function friendNext (dhts, ip) {
  var l = dhts.length
  // var ip = external ? ips.external : ips.internal
  for (var i = 0; i < l; i++) {
    var next = dhts[(i + 1) % l]
    dhts[i].addNode(ip + ':' + next.address().port, next.nodeId)
  }
}

function friendFirst (dhts, ip) {
  befriend(dhts.slice(1), dhts[0], ip)
}

function befriend (dhts, dht, ip) {
  var l = dhts.length
  var port = dht.address().port
  var nodeId = dht.nodeId
  // var ip = external ? ips.external : ips.internal
  for (var i = 0; i < l; i++) {
    dhts[i].addNode(ip + ':' + port, nodeId)
  }
}
