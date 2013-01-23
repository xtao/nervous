// configuration
var interval = 15*1000;

var kstat = {
    'link':{
        'num': 25,
        'name_id': 2,
        'stat':[
            'obytes',
            'obytes64',
            'rbytes',
            'rbytes64'
        ]
    },
    'disk':{
        'num': 15,
        'name_id': 2,
        'stat':[
            'reads',
            'nread',
            'writes',
            'nwritten'
        ]
    }
};

//deps
var child_process = require('child_process');

//code
//our plugin main function
module.exports = function( axon ) {

    var emit_kstat = function(type, data) {
        for (var id in type) {
            axon.emit( 'data',  data['nervous_type'] + '.' + data['nervous_name'] + '.' + type[id], data[type[id]] );
        }
    };

    var on_kstat_complete = function(err, stdout, stderr, type_name) {
        var data = [];
        var field = [];
        var type = kstat[type_name];
        var lines = stdout.split('\n');
        var length = parseInt(lines.length / type['num']);
        for (var i = 0; i < length; i++) {
            data = [];
            field = [];
            for (var j = type['num'] * i; j < type['num'] * (i + 1); j++) {
                field = lines[j].split(':');
                if (field.length < 4) {
                    continue;
                }
                var metric = field[3].split('\t');
                data[metric[0]] = metric[1];
            }
            data['nervous_name'] = field[type['name_id']];
            data['nervous_type'] = type_name;
            emit_kstat(type, data);
        }
    };

    var on_link_complete = function( err, stdout, stderr ) {
        on_kstat_complete(err, stdout, stderr, 'link');
    };

    var on_load_avg_complete = function( err, stdout, stderr ) {
        var lines = stdout.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var matches = lines[i].match(/load average: (.*?), (.*?), (.*?)/);
            if (matches === null) {
                continue;
            }
            var metric = matches[1];
            axon.emit( 'data',  'load.avg', metric );
        }
    };

    var on_load_complete = function( err, stdout, stderr ) {
        /* r id free swap sr w */
        var KTHR_R_ID = 0;
        var MEMORY_FREE_ID = 4;
        var CPU_ID_ID = 21;
        var lines = stdout.split('\n');
        if (lines.length < 3) {
            return;
        }
        for (var i = 2; i < lines.length; i++) {
            var payload = lines[i];
            payload = payload.replace(/[ ]+/g, ' ').replace(/^ /, '').replace(/ $/, '');
            var field = payload.split(' ');
            if (field.length < 21) {
                continue;
            }
            var runqueue = field[KTHR_R_ID];
            var idle = field[CPU_ID_ID];
            var free = field[MEMORY_FREE_ID];
            axon.emit( 'data',  'load.runqueue', runqueue );
            axon.emit( 'data',  'load.idle', idle );
            axon.emit( 'data',  'load.free', free );
        }
    };

    var on_disk_complete = function( err, stdout, stderr ) {
        on_kstat_complete(err, stdout, stderr, 'disk');
    };

    var on_df_complete = function( err, stdout, stderr ) {
        var FILE_SYSTEM_ID = 0;
        var KBYTES_ID = 1;
        var USED_ID = 2;
        var AVAIL_ID = 3;
        var CAPACITY_ID = 4;
        var lines = stdout.split('\n');
        if (lines.length < 2) {
            return;
        }
        for (var i = 1; i < lines.length; i++) {
            var payload = lines[i];
            payload = payload.replace(/[ ]+/g, ' ').replace(/^ /, '').replace(/ $/, '');
            var field = payload.split(' ');
            if (field.length < 5) {
                continue;
            }
            var used = field[USED_ID];
            var avail = field[AVAIL_ID];
            var matches = field[CAPACITY_ID].match(/()%/);
            if (matches === null) {
                continue;
            }
            var cap = matches[1];
            axon.emit( 'data',  'zones.used', used );
            axon.emit( 'data',  'zones.avail', avail );
            axon.emit( 'data',  'zones.capacity', cap );
        }
    };

    //this checks it
    var check_global_zone_usage = function() {
        child_process.exec( 'uptime ', on_load_avg_complete);
        child_process.exec( 'vmstat 1 1 ', on_load_complete);
        child_process.exec( 'kstat -c disk -p', on_disk_complete);
        child_process.exec( 'df -k zones', on_df_complete);
        child_process.exec( 'kstat -m link -n igb* -p', on_link_complete );
    };

    setInterval( check_global_zone_usage, interval );
};
