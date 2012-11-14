/* This program is free software: you can redistribute it and/or
   modify it under the terms of the GNU Lesser General Public License
   as published by the Free Software Foundation, either version 3 of
   the License, or (at your option) any later version.
   
   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.
   
   You should have received a copy of the GNU General Public License
   along with this program.  If not, see <http://www.gnu.org/licenses/>. 
*/

otp.namespace("otp.modules.bikeshare");

otp.modules.bikeshare.StationModel = 
    Backbone.Model.extend({
    
    isWalkableFrom: function(point, tolerance) {
        return (Math.abs(this.get('x') - point.lng) < tolerance && 
                Math.abs(this.get('y') - point.lat) < tolerance);
    },
    
    isNearishTo: function(point, tolerance) {
        return (this.distanceTo(point) < tolerance && 
                parseInt(this.get('bikesAvailable')) > 0);
    },
    
    distanceTo: function(point) {
        var distance = otp.modules.bikeshare.Utils.distance;
        return distance(this.get('x'), this.get('y'), point.lng, point.lat);
    }
});

otp.modules.bikeshare.StationCollection = 
    Backbone.Collection.extend({
    
    url: otp.config.hostname + '/opentripplanner-api-webapp/ws/bike_rental',
    model: otp.modules.bikeshare.StationModel,
    
    sync: function(method, model, options) {
        options.dataType = 'jsonp';
        options.data = options.data || {};
        if(otp.config.routerId !== undefined) {
            options.data.routerId = otp.config.routerId;
        }
        return Backbone.sync(method, model, options);
    },
    
    parse: function(rawData, options) {
        var stationsData = _.pluck(rawData.stations, 'BikeRentalStation');
        return Backbone.Collection.prototype.parse.call(this, stationsData, options);
    }
});

otp.modules.bikeshare.Utils = {
    distance : function(x1, y1, x2, y2) {
        return Math.sqrt((x1-x2)*(x1-x2) + (y1-y2)*(y1-y2));
    }    
};

/* main class */

otp.modules.bikeshare.BikeShareModule = 
    otp.Class(otp.modules.planner.PlannerModule, {
    
    moduleName  : "Bike Share Planner",
    moduleId    : "bikeshare",

    resultsWidget   : null,
    
    stations    : null,    
    stationLookup :   { },
    stationsLayer   : null,
     
    initialize : function(webapp) {
        otp.modules.planner.PlannerModule.prototype.initialize.apply(this, arguments);
    },
    
    activate : function() {
        if(this.activated) return;
        otp.modules.planner.PlannerModule.prototype.activate.apply(this);
        this.mode = "BICYCLE";
        
        this.stationsLayer = new L.LayerGroup();
        this.addLayer("Bike Stations", this.stationsLayer);

        this.initStations();

        var this_ = this;
        setInterval(function() {
            this_.reloadStations();
        }, 30000);
       
    },

    planTripStart : function() {
        console.log("rsm");
        this.resetStationMarkers();
    },
    
    processPlan : function(tripPlan, queryParams, restoring) {
        var itin = tripPlan.itineraries[0];
        var this_ = this;
        
	    if(this.resultsWidget == null) {

            this.resultsWidget = new otp.widgets.TripWidget('otp-'+this.moduleId+'-tripWidget', this);
            /*this.resultsWidget = new otp.widgets.TripWidget('otp-'+this.moduleId+'-tripWidget', function() {
                this_.trianglePlanTrip();
            });*/
            this.widgets.push(this.resultsWidget);
            
            this.resultsWidget.addPanel("summary", new otp.widgets.TW_TripSummary(this.resultsWidget));
            this.resultsWidget.addSeparator();
            this.resultsWidget.addPanel("triangle", new otp.widgets.TW_BikeTriangle(this.resultsWidget));
            this.resultsWidget.addSeparator();
            this.resultsWidget.addPanel("biketype", new otp.widgets.TW_BikeType(this.resultsWidget));
            
            if(restoring) { //existingQueryParams !== null) {
                console.log("restoring");
                this.resultsWidget.restorePlan(queryParams);
            }
            this.resultsWidget.show();
        }
                        
        this.drawItinerary(itin);
        
        if(queryParams.mode === 'WALK,BICYCLE') { // bikeshare trip
            var polyline = new L.Polyline(otp.util.Polyline.decode(itin.legs[1].legGeometry.points));
            var start_and_end_stations = this.processStations(polyline.getLatLngs()[0], polyline.getLatLngs()[polyline.getLatLngs().length-1]);
        }
        else { // "my own bike" trip
           	this.resetStationMarkers();
        }	

        this.resultsWidget.show();
        this.resultsWidget.newItinerary(itin);
                    
        if(start_and_end_stations !== undefined && queryParams.mode === 'WALK,BICYCLE') {
            if(start_and_end_stations['start'] && start_and_end_stations['end']) {
           	    this.bikestationsWidget.setContentAndShow(
           	        start_and_end_stations['start'], 
           	        start_and_end_stations['end'],
           	        this);
           	    this.bikestationsWidget.show();
           	}
           	else
           	    this.bikestationsWidget.hide();
        }
       	else {
       	    this.bikestationsWidget.hide();
       	}
    },
    
    noTripFound : function() {
        this.resultsWidget.hide();
    },
        
    processStations : function(start, end) {
        var this_ = this;
        var tol = .0005, distTol = .01;
        var start_and_end_stations = [];
        var distance = otp.modules.bikeshare.Utils.distance;
        
        this.stations.each(function(station) {
            var stationData = station.toJSON();
            
            if (station.isWalkableFrom(start, tol)) {
                // start station
                this.setStationMarker(station, "PICK UP BIKE", this.icons.startBike);
                start_and_end_stations['start'] = station;
            }
            else if (station.isNearishTo(this.startLatLng, distTol)) {
                // start-adjacent station
                var distanceToStart = station.distanceTo(this.startLatLng);
                var icon = distanceToStart < distTol/2 ? this.icons.getLarge(stationData) : this.icons.getMedium(stationData);
                this.setStationMarker(station, "ALTERNATE PICKUP", icon);
            }
            else if (station.isWalkableFrom(end, tol)) {
                // end station
                this.setStationMarker(station, "DROP OFF BIKE", this.icons.endBike);
                start_and_end_stations['end'] = station;
            }
            else if (station.isNearishTo(this.endLatLng, distTol)) {
                // end-adjacent station
                var distanceToEnd = station.distanceTo(this.endLatLng);
                var icon = distanceToEnd < distTol/2 ? this.icons.getLarge(stationData) : this.icons.getMedium(stationData);
                this.setStationMarker(station, "ALTERNATE DROP OFF", icon);
            }
            else {
                icon = icon || this.icons.getSmall(stationData);
                this.setStationMarker(station, "BIKE STATION", icon);
            }
        }, this);
        
        return start_and_end_stations;
    },
    
    onResetStations : function(stations) {
        this.resetStationMarkers();
    },
    
    resetStationMarkers : function() {
        this.stations.each(function(station) {
            this.setStationMarker(station); }, this);
    },

    clearStationMarkers : function() {
        _.each(_.keys(this.markers), function(stationId) {
            this.removeStationMarker(stationId); }, this);
    },
    
    getStationMarker : function(station) {
        if (station instanceof Backbone.Model)
            return this.markers[station.id];
        else
            return this.markers[station];
    },
    
    removeStationMarker : function(station) {
        var marker = this.getStationMarker(station);
        if (marker)
            this.stationsLayer.removeLayer(marker);
    },
    
    addStationMarker : function(station, title, icon) {
        var stationData = station.toJSON(),
            marker;
        icon = icon || this.icons.getSmall(stationData);
        
        marker = new L.Marker(new L.LatLng(stationData.y, stationData.x), {icon: icon});
        this.markers[station.id] = marker;
        this.stationsLayer.addLayer(marker);
        marker.bindPopup(this.constructStationInfo(title, stationData));
    },
    
    setStationMarker : function(station, title, icon) {
        var marker = this.getStationMarker(station);
        if (!marker)
            marker = this.addStationMarker(station, title, icon);
        else {
            this.updateStationMarker(marker, station, title, icon);
        }
    },
    
    updateStationMarker : function(marker, station, title, icon) {
        var stationData = station.toJSON();
        
        if (icon) marker.setIcon(icon);
        marker.bindPopup(this.constructStationInfo(title, stationData));
    },
    
    initStations : function() {
        //console.log('init stations');
        this.markers = {};
        this.stations = new otp.modules.bikeshare.StationCollection();
        this.stations.on('reset', this.onResetStations, this);
        
        this.stations.fetch();
    },

    reloadStations : function(stations) {
        //console.log('update stations');
        this.stations.fetch();
    },
            
    constructStationInfo : function(title, station) {
        if(title == null) {
            title = (station.markerTitle !== undefined) ? station.markerTitle : "BIKE STATION";
        }
        var info = "<strong>"+title+"</strong><br/>";
        station.markerTitle = title;
        info += '<strong>Station:</strong> '+station.name+'<br/>';
        info += '<strong>Bikes Available:</strong> '+station.bikesAvailable+'<br/>';
        info += '<strong>Docks Available:</strong> '+station.spacesAvailable+'<br/>';
        return info;
    },
                
    CLASS_NAME : "otp.modules.bikeshare.BikeShareModule"
});
