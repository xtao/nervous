// configuration
var interval = 15*1000;

var ZONE_ID    =   0;
var UUID_ID    =   1;
var TYPE_ID    =   2;
var RAM_ID     =   3;
var STATE_ID   =   4;
var PID_ID     =   5;
var ALIAS_ID   =   6;
var vm_list = [];

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
    },
    'cpu':{
        'num': 15,
        'name_id': 2,
        'stat':[
            'usage',
            'value'
        ]
    }
    };

var link_field_total_num = 25;
var link_field_to_post = [
    'obytes',
    'obytes64',
    'rbytes',
    'rbytes64'
];

var zone_zfs_field_total_num = 11;
var zone_zfs_field_to_post = [
    'reads',
    'nread',
    'writes',
    'nwritten',
];

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
            emit_kstat(type['stat'], data);
        }
    };

    var emit_data = function(data) {
        axon.emit( 'data',  data['alias'] + '.' + data['name'], data['data'] );
    };

    var on_cpu_complete = function( err, stdout, stderr ) {
        on_kstat_complete(err, stdout, stderr, 'cpu');
    };

    var emit_link = function(link) {
        var data = [];
        var zone_name = link['zonename']
        var zone_info = vm_list[zone_name];
        var zone_alias = zone_info[ALIAS_ID];
        zone_alias = zone_alias.replace(/\./, '_');
        data['alias'] = zone_alias;
        for (var i = 0; i < link_field_to_post.length; i++) {
            data['name'] = link['name'] + '.' + link_field_to_post[i];
            data['data'] = link[link_field_to_post[i]];
            emit_data(data);
        }
    };

    var on_link_complete = function( err, stdout, stderr ) {
        var link = [];
        var lines = stdout.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var field = lines[i].split(':');
            if (field.length < 4) {
                continue;
            }
            var metric = field[3].split('\t');
            link[metric[0]] = metric[1];
            if (i % link_field_total_num == link_field_total_num - 1) {
                link['name'] = field[2];
                emit_link(link);
                link = [];
            }
        }
    };

    var on_disk_complete = function( err, stdout, stderr ) {
        var lines = stdout.split('\n');
        for (var i = 1; i < lines.length; i++) {
            var data = [];
            var matches = lines[i].match(/zones\/([a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12})-(disk[0-9]+)[ ]+(\d+)/ );
            if (matches == null)
                continue;
            var zone_name = matches[1];
            var zone_info = vm_list[zone_name];
            if (zone_info == undefined) {
                continue;
            }
            var zone_alias = zone_info[ALIAS_ID];
            zone_alias = zone_alias.replace(/\./, '_');
            data['alias'] = zone_alias;
            data['name'] = matches[2] + '_used';
            data['data'] = matches[3];
            emit_data(data);
        }
    };

    var emit_zfs = function(zfs) {
        var data = [];
        var zone_name = zfs['zonename']
        var zone_info = vm_list[zone_name];
        var zone_alias = zone_info[ALIAS_ID];
        zone_alias = zone_alias.replace(/\./, '_');
        data['alias'] = zone_alias;
        for (var i = 0; i < zone_zfs_field_to_post.length; i++) {
            data['name'] = zfs['name'] + '.' + zone_zfs_field_to_post[i];
            data['data'] = zfs[zone_zfs_field_to_post[i]];
            emit_data(data);
        }
    };

    var on_zfs_complete = function( err, stdout, stderr ) {
        var zfs = [];
        var lines = stdout.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var field = lines[i].split(':');
            if (field.length < 4) {
                continue;
            }
            var metric = field[3].split('\t');
            zfs[metric[0]] = metric[1];
            if (i % zone_zfs_field_total_num == zone_zfs_field_total_num - 1) {
                zfs['name'] = field[2];
                emit_zfs(zfs);
                zfs = [];
            }
        }
    };

    var on_exec_complete = function( err, stdout, stderr ) {
        var lines = stdout.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var field = lines[i].split(':');
            if (field.length < 6) {
                continue;
            }
            if (field[TYPE_ID] != 'KVM') {
                continue;
            }
            vm_list[field[ZONE_ID]] = field;
            vm_list[field[UUID_ID]] = field;
            child_process.exec( 'kstat -p caps::cpucaps_zone_' + field[ZONE_ID], on_cpu_complete);
            child_process.exec( 'kstat -m link -n z' + field[ZONE_ID]  + '_net* -p', on_link_complete);
            child_process.exec( 'kstat -m zone_zfs -i ' + field[ZONE_ID] + ' -p', on_zfs_complete);
        }
        child_process.exec( 'zfs list -p -o name,used', on_disk_complete );
    };

    //this checks it
    var check_vm_usage = function() {
        child_process.exec( 'vmadm list -p -o zoneid,uuid,type,ram,state,pid,alias|grep :KVM:', on_exec_complete );
    };

    setInterval( check_vm_usage, interval );
};
