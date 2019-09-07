define([
    'dojo/_base/declare',
    'dijit/_WidgetBase',
    'dijit/_TemplatedMixin',
    'dijit/_WidgetsInTemplateMixin',
    'dijit/Dialog',
    'dijit/ConfirmDialog',
    'dijit/form/DateTextBox',
    'dojo/request',
    'dojo/_base/lang',
    'dojo/on',
    'dojo/query',
    'dojo/dom',
    'dojo/dom-class',
    'dojo/html',
    'dojo/topic',
    'dojo/store/Memory',
    'dojo/Deferred',
    'dojo/promise/all',

    'dojo/text!./AoiEditor/templates/Sidebar.html', // template for the widget in left panel, and some dialogs
    'dojo/text!./AoiEditor/templates/Dialog.html', // template for the open AOI dialog

    'esri/dijit/editing/Add',
    'esri/dijit/editing/Delete',
    'esri/dijit/editing/Update',

    'esri/toolbars/draw',
    'esri/toolbars/edit',

    'esri/geometry/Extent',

    'esri/layers/FeatureLayer',
    'esri/layers/GraphicsLayer',
    'esri/graphic',

    'esri/renderers/SimpleRenderer',
    'esri/symbols/SimpleMarkerSymbol',
    'esri/symbols/SimpleLineSymbol',
    'esri/symbols/SimpleFillSymbol',
    'esri/Color',

    'esri/tasks/BufferParameters',
    'esri/tasks/query',

    './js/config/projects.js', //TODO put in app.js paths?

    'proj4js/proj4',

    'dijit/form/Form',
    'dijit/form/FilteringSelect',
    'dijit/form/CheckBox',
    'dijit/form/ValidationTextBox',
    'dijit/form/TextBox',
    'dijit/form/Select',

    'xstyle/css!./LayerLoader/css/layerLoader.css'
],
    function (declare, _WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin, Dialog, ConfirmDialog, DateTextBox, request, lang, on, query, dom, //eslint-disable-line no-unused-vars
        domClass, html, topic, Memory, Deferred, all, AoiEditorSidebarTemplate, AoiEditorDialogTemplate, //eslint-disable-line no-unused-vars
        Add, Delete, Update, Draw, Edit, Extent, FeatureLayer, GraphicsLayer, Graphic, SimpleRenderer,
        SimpleMarkerSymbol,
        SimpleLineSymbol,
        SimpleFillSymbol, 
        Color,
        BufferParameters,
        Query,
        projects,
        proj4
    ) { //eslint-disable-line no-unused-vars
        return declare([_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin], {
            widgetsInTemplate: true,
            templateString: AoiEditorSidebarTemplate,
            topicID: 'AoiEditor',
            baseClass: 'AoiEditor',
            map: this.map,
            featureTypes: ['polygon', 'polyline', 'point'], //preprended with "aoi_" as id of layer, referenced in layers object as self.layers.point, etc.
            layers: {}, //caches the layers
            /*bufferUnits: [
                {id: 9002, name: 'Feet', abbreviation: 'Ft'}, 
                {id: 9003, name: 'Miles', abbreviation: 'Mi'},
                {id: 9001, name: 'Meters', abbreviation: 'M'},
                {id: 9036, name: 'Kilometers', abbreviation: 'KM'},
            ],*/
            bufferUnits: {
                feet: { id: 9002, name: 'Feet', abbreviation: 'ft' }, //for simplicity of converting from strings
                miles: { id: 9093, name: 'Miles', abbreviation: 'mi' },
                meters: { id: 9001, name: 'Meters', abbreviation: 'm' },
                kilometers: { id: 9036, name: 'Kilometers', abbreviation: 'km' },
            },
            //bufferUnitArray: [bufferUnits.feet, bufferUnits.miles, bufferUnits.meters, bufferUnits.kilometers], //for binding to drop-down
            //lastUnit: bufferUnits.feet,
            lastBufferDistance: 100,

            constructor: function (options) {
                this.currentAuthority = options.currentAuthority;
            },

            //knockout-bound observable properties, will be assigned in _knockoutify method
            aois: null,
            currentAoi: null,
            filterAois: null,

            //Dialogs. Broader scope needed for these dialogs to support closing when option is selected, so declaring these here
            openAoiDialog: null,

            openAOI: function () {
                //todo
            },

            createAoi: function () {
                var aoi = this._constructAoiModel();
                this.currentAoi(aoi);
                aoi.mode('editName');
            },

            //FOR TESTING ONLY
            test: function (id) {
                this.createAoi();
                this.currentAoi().id = id;
                this._loadAoiFeatures();
                this.currentAoi().showFeatureList();
            },

            loadAoi: function (id) {
                var self = this;
                //get from server
                //eslint-disable-next-line no-undef
                MapDAO.getAoiModel(id, {
                    callback: function (aoi) {
                        if (aoi) {
                            aoi = self._constructAoiModel(aoi);
                            self.currentAoi(aoi);
                            self._loadAoiFeatures();
                            aoi.mode('editName');
                        } else {
                            topic.publish('viewer/handleError', {
                                source: 'AoiEditor.loadAoi',
                                error: 'Invalid AOI ID'
                            });

                        }
                    },
                    errorHandler: function (message, exception) {
                        topic.publish('viewer/handleError', {
                            source: 'AoiEditor.loadAoi',
                            error: 'Error message is: ' + message + ' - Error Details: ' + dwr.util.toDescriptiveString(exception, 2) //eslint-disable-line no-undef
                        });
                        if (savedMap.deferred) {
                            savedMap.deferred.reject(message);
                        }
                    }
                });

            },

            lastEditAt: null, //tracks last time an edit was made, used for timeout-based updating of buffers, starting immediately after draw-complete, or 3 seconds after vertext-drag-end

            _constructFeatureLayer: function (layerId, aoiId) {
                var layer = new FeatureLayer('https://aquarius.at.geoplan.ufl.edu/arcgis/rest/services/etdm_services/AOIDEV_INPUT/FeatureServer/' + layerId, {
                    opacity: 0.75,
                    mode: FeatureLayer.MODE_ONDEMAND,
                    infoTemplate: new InfoTemplate(null, '${*}'),
                    id: 'aoi_' + aoiId + '_' + layerId,
                    definitionQuery: '1=1' //TODO
                });
                return this.map.addLayer(layer);

            },

            postCreate: function () {
                this.inherited(arguments);
                //todo post create code goes here
                //this._createGraphicLayers();


            },

            startup: function () {
                this.inherited(arguments);

                this.bufferUnitArray = [this.bufferUnits.feet, this.bufferUnits.miles, this.bufferUnits.meters, this.bufferUnits.kilometers]; //for binding to drop-down
                this.lastUnit = this.bufferUnits.feet;
            
                //this.proj4 = proj4;
                //for debugging only
                //window.proj4 = proj4;
                this._createGraphicLayers();
                //this entire widget will be hidden if user doesn't have at least one aoi auth, so don't need to worry about index out of bounds
                if (!this.currentAuthority() || this.currentAuthority().aoiEditor === false) {
                    this.currentAuthority(this.authorities[0]);
                }
                this._setupEditor();
                this._knockoutifyAoiEditor();
            },

            _setupEditor: function () {
                var self = this; //closure so we can access this.draw etc.
                this.draw = new Draw(this.map); //draw toolbar, not shown in UI, but utilized by our UI
                this.edit = new Edit(this.map);

                //event handler for draw complete, creates a new feature when user finishes digitizing
                //
                this.draw.on('draw-complete', function (event) {
                    var layer = self.layers[event.geometry.type],
                        aoi = self.currentAoi();

                    //toggle back to default map click mode
                    topic.publish('mapClickMode/setDefault');
                    self.draw.deactivate();
                    //if something has gotten wildly out of sorts, bail
                    if (!layer || !aoi) {
                        return;
                    }

                    //construct a feature
                    var f = self._constructFeature(event);
                    
                    //save to server
                    layer.applyEdits([f.graphic], null, null, function(a,u,d) {
                        //todo check a and make sure successfull
                        //make it active
                        aoi.currentFeature(f);

                        //push it to features observableArray
                        aoi.features.push(f);

                    }, function(e) {
                        debugger;
                    });

                    //todo add to undo stack

                });

                //event handler function for vertext move and delete
                var vertexChanged = function (evt) {
                    var delay = 2000, //number of seconds to give the user before we automatically rebuffer
                        graphic = evt.graphic,
                        feature = graphic.feature;

                    self.lastEditAt = new Date();
                    self.vertexMoving = false;
                    //update buffer after short delay
                    //the delay prevents annoying the user if they're busy moving several vertices
                    window.setTimeout(function () {
                        //if another vertex move has happened in the built-in delay since this function was called, do not buffer
                        var now = new Date(),
                            duration = now.getTime() - self.lastEditAt.getTime(); //# of milliseconds since the last time vertex move stop happened
                        if (duration >= delay && !self.vertexMoving) {
                            self.bufferFeature(self.currentAoi().currentFeature());
                            //save to database
                            feature.updateDatabase();
                        }
                    }, delay);
                };

                var deleteBuffer = function (evt) {
                    //remove the buffer graphic
                    var buffer = evt.graphic.feature.buffer;
                    if (buffer) {
                        self.bufferGraphics.remove(buffer);
                    }
                };

                this.edit.on('vertex-move-stop', vertexChanged, this);
                this.edit.on('vertex-delete', function (evt) {
                    deleteBuffer(evt);
                    this.lastEditAt = new Date();
                    vertexChanged(evt);
                }, this);
                this.edit.on('vertex-first-move', function (evt) {
                    this.lastEditAt = new Date();
                    this.vertexMoving = true;
                    deleteBuffer(evt);
                });
                this.edit.on('vertex-move', function (evt) {
                    this.lastEditAt = new Date();
                    this.vertexMoving = true;
                }, this);
                //TODO we can also support scaling, etc.
                //TODO handle merge/split  
            },

            //user clicks the Point, Line, Freehand Line, Polygon or Freehand Polygon digitize button
            digitizeFeature: function (toolName) {
                //toolname is one of the draw tools
                this.draw.activate(toolName);
                //todo turn off identify
                topic.publish('mapClickMode/setCurrent', 'digitize');
                //hides the dialog, constructs stub of feature, puts map in click-to-digitize- mode, shows tips in sidebar, along with cancel button
                //onDrawFinish event creates a point feature, hides tip and shows the features list, with newly created feature with default name selected, saves to point feature class
                //this.currentFeature = this._constructFeature(featureType);
            },

            //clears features from the map. It doesn't destroy them or affect the AOI model.
            clearFeatures: function () {
                this.pointGraphics.clear();
                this.polylineGraphics.clear();
                this.polygonGraphics.clear();
                this.bufferGraphics.clear();
            },

            _constructAoiModel: function (aoi) {
                var self = this;
                aoi = aoi || { id: -1 /*signifies new*/, name: null, type: null, expirationDate: null, orgUserId: null, description: null, features: [] };

                if (!aoi.expirationDate) {
                    //default date is current date + 30 days TODO confirm this
                    //TODO for demo purposes only
                    aoi.expirationDate = '09/15/2019'; //new Date();
                    //aoi.expirationDate.setDate(aoi.expirationDate.getDate() + 30);
                }
                var authority = null;
                if (aoi.orgUserId) {
                    //loading existing--if we allow loading all aois for all of the current user's orgUsers, rather than having to select to filter them, we don't need this bit
                    //about tracking authority, and just use currentAuthority
                    authority = this.authorities.find(function (auth) {
                        return auth.orgUserId === aoi.orgUserId;
                    });
                } else {
                    authority = this.currentAuthority(); //default
                }
                /* eslint-disable no-undef */
                aoi.name = ko.observable(aoi.name);
                aoi.description = ko.observable(aoi.description);
                aoi.projectTypeId = ko.observable(aoi.projectTypeId);
                aoi.expirationDate = ko.observable(aoi.expirationDate);

                //navigation
                aoi.mode = ko.observable();
                aoi.showFeatureList = function () {
                    //todo validate name, etc.
                    //save, and wait for callback to update id
                    aoi.mode('editFeatures');
                    //todo if features.length === 0 show the new feature dialog
                };
                aoi.showAnalysisOptions = function () {
                    //todo validate >0 features, features have buffers, etc.
                    aoi.mode('analysisOptions');
                };

                aoi.authority = ko.observable(authority);
                aoi.showAuthoritySelection = ko.pureComputed(function () {
                    return !aoi.id && this.authorities.length > 1; //TODO lose this reference to app
                }, this);
                aoi.features = ko.observableArray();
                aoi.currentFeature = ko.observable();
                aoi.analysisAreas = ko.computed(function () {
                    var analysisAreas = [];

                    ko.utils.arrayForEach(aoi.features(), function (f) {
                        if (f.analysisArea() && analysisAreas.indexOf(f.analysisArea()) < 0) {
                            analysisAreas.push(f.analysisArea());
                        }    return f.analysisArea();
                    });

                    return analysisAreas;
                });
                aoi.currentFeature.subscribe(function (f) {
                    if (f && (f.type === 'polygon' || f.type === 'polyline') && f.graphic) {
                        self.edit.activate(2, f.graphic);
                    } else {
                        self.edit.activate(1, f.graphic);
                    }
                });

                aoi.getAnalysisAreaModel = function (name) {
                    return ko.utils.arrayFirst(aoi.analysisAreas(), function(m) {
                        return m.name() === name;
                    });
                };

                aoi.getAnalysisAreaFeature = function (name) {
                    return ko.utils.arrayFirst(self.layers.analysisArea.graphics, function(f) {
                        return f.attributes.NAME === name;
                    });
                };

                /**
                 * Builds the adds, edits and deletes arrays of analysisAreas; returns a deferred object that, when resolved, passes the 
                 * arrays, ready for applyEdits. Makes external calls to geometryService to simplify and union.
                 */
                aoi._buildAnalysisAreaFeatureEdits = function () {
                    aoi._buildAnalysisAreasFromFeatures();
                    //get union of buffers of features, group by analysisArea
                    //remove any analysisArea features not currently represented
                    var analysisAreaFeatures = self.layers.analysisArea.graphics,
                        analysisAreaModels = aoi.analysisAreas(),
                        result = {
                            adds: [],
                            updates: [],
                            deletes: ko.utils.arrayFilter(analysisAreaFeatures, function (f) {
                                var existing = aoi.getAnalysisAreaModel(f.attributes.NAME)
                                return !existing;
                            }) //analysisArea features that don't currently have a match in named analysis areas
                        },
                        deferred = new Deferred(),
                        promises = [];

                    //loop through models to add or update
                    //todo switch to forEach, for ease of debugging I'm currently using this for loop
                    for (var i = 0; i<analysisAreaModels.length; i++) {
                        var analysisAreaModel = analysisAreaModels[i],
                            geometries = ko.utils.arrayMap(analysisAreaModel.features(), function (f) {
                                return f.buffer ? f.buffer.geometry : f.graphic.geometry;
                            }),
                            promise = new Deferred();

                        promises.push(promise);

                        //simplify
                        esriConfig.defaults.geometryService.simplify(geometries).then(function (simplifiedGeometries) {
                            //Note, just a union request would do the job, but maybe this is useful for multiple buffers?
                            var params = new BufferParameters();
                            
                            params.distances = [0]; 
                            params.outSpatialReference = self.map.spatialReference; //todo this should maybe be Albers
                            params.unit = 9002;
                            params.geometries = simplifiedGeometries;
                            params.unionResults = true;

                            esriConfig.defaults.geometryService.buffer(params,
                                function (bufferedGeometries) {
                                    //todo save to s_aoi
                                    //search for existing feature by name
                                    var analysisAreaFeature = aoi.getAnalysisAreaFeature(analysisAreaModel.name());
                                    if (analysisAreaFeature) {
                                        result.updates.push(analysisAreaFeature);
                                        promise.resolve();
                                    } else {
                                        analysisAreaFeature = new Graphic(bufferedGeometries[0]); //todo if we can create multiple buffers in one go with different buffer distances, will need to foreach through those
                                        //get ID from sequence
                                        MapDAO.getNextAnalysisAreaId({
                                            callback: function(id) {
                                                analysisAreaFeature.attributes = {
                                                    OBJECTID: null,
                                                    BUFFER_DISTANCE: 1,
                                                    FEATURE_NAME: analysisAreaModel.name(),
                                                    FK_PROJECT: aoi.id,
                                                    FK_PROJECT_ALT: id
                                                };
                                                result.adds.push(analysisAreaFeature);
                                                promise.resolve();
                                            }
                                        });
                                    }
                                },
                                function (err) {
                                    promise.reject(err);
                                }
                            );


                        });
                    } // end loop through analysisAreaModels

                    all(promises).then(function () {
                        deferred.resolve(result);
                    });

                    return deferred;

                };

                //construct analysisAreas for features that don't already have one, using the feature's name as the analysisArea name
                aoi._buildAnalysisAreasFromFeatures = function() {
                    ko.utils.arrayForEach(aoi.features(), function (f) {
                        if (!f.analysisArea()) {
                            self._addFeatureToAnalysisArea(f, f.name());
                        }
                    });
                };

                aoi.saveAnalysisAreas = function () {
                    aoi._buildAnalysisAreaFeatureEdits().then(function (edits) {
                        self.layers.analysisArea.applyEdits(edits.adds, edits.updates, edits.deletes, function(a,u,d) {
                            ko.utils.arrayForEach(a, function (analysisAreaFeature) {
                            })
                        }, function(e) {
                            debugger;
                        });;
                    });
                };

                /* eslint-enable no-undef */
                return aoi;
            },

            _loadAoiFeatures: function () {
                var self = this,
                    aoi = this.currentAoi();

                //remove existing layers from the map
                if (self.layers.analysisArea) {
                    self.map.removeLayer(self.layers.analysisArea);
                    delete self.layers.analysisArea;
                }
                self.featureTypes.forEach(function(layerName) {
                    if (self.layers[layerName]) {
                        self.map.removeLayer(self.layers[layerName]);
                        delete self.layers[layerName];
                    }
                });

                if (!aoi) {
                    return;
                }

                //get analysisAreas first
                self.layers.analysisArea = new FeatureLayer(projects.aoiLayers.analysisArea.url, {
                    id: 'aoi_analysisAreas',
                    outFields: '*',
                    definitionExpression: 'FK_PROJECT = ' + aoi.id,
                    //visible: false,
                    mode: FeatureLayer.MODE_SNAPSHOT 
                });
                on.once(self.layers.analysisArea, 'update-end', function () {
                    //we now have self.layers.analysisArea.graphics as array of the analysis areas as GIS features
                    //get the rest of the features and build relationships
                    var promises = []; //tracks on-update-end for all layers, zooms to unioned extent when done
                    self.featureTypes.forEach(function (layerName) {
                        var url = projects.aoiLayers[layerName].url,
                            deferred = new Deferred(),
                            layer = new FeatureLayer(url,
                                {
                                    id: 'aoi_' + layerName,
                                    outFields: '*',
                                    definitionExpression: 'FK_PROJECT = ' + aoi.id,
                                    mode: FeatureLayer.MODE_SNAPSHOT //gets all features! TODO or does it? What happens if it's not in the current map's extent?
                                });
                        self.layers[layerName] = layer;
                        promises.push(deferred);

                        on.once(layer, 'update-end', function (info) {
                            deferred.resolve(info.target);
                        });

                        self.map.addLayer(layer);
                    });

                    //for debugging only
                    window.promises = promises;

                    all(promises).then(function (layers) {
                        //extract all features
                        var allGraphics = [],
                            unionOfExtents,
                            featuresKo = [],
                            onLayerClick = function (evt) {
                                //subscription on currentFeature does this edit.activate(2, evt.graphic);
                                if (self.currentAoi() && evt.graphic && evt.graphic.feature) {
                                    event.stopPropagation(evt);
                                    self.currentAoi().currentFeature(evt.graphic.feature);
                                }
                            };

                        layers.forEach(function (layer) {
                            allGraphics = allGraphics.concat(layer.graphics);
                            on(layer, 'click', onLayerClick);
                        });

                        //union extents, but only those with actual extents
                        for (var i = 0; i < allGraphics.length; i++) { //todo switch to foreach; this way to simplify debugging
                            var graphic = allGraphics[i],
                                geometry = graphic.geometry,
                                featureKO = self._constructFeature(graphic),
                                extent;
                            featuresKo.push(featureKO);
                            if (geometry) {
                                if (geometry.type === 'point') {
                                    extent = new Extent(geometry.x, geometry.y, geometry.x, geometry.y, geometry.spatialReference);
                                } else {
                                    extent = geometry.getExtent();
                                }
                                if (extent) {
                                    unionOfExtents = unionOfExtents ? unionOfExtents.union(extent) : extent;
                                }
                            }
                        }
                        if (unionOfExtents) {
                            //todo this fails if there's just one point. See zoomToFeature for example, may need to centerAndZoom; in theory even if there's just one point, there will be a buffer of that point in S_AOI, so  might not be an issue
                            unionOfExtents = unionOfExtents.expand(1.5);
                            topic.publish('layerLoader/zoomToExtent', unionOfExtents);
                        }

                        aoi.features(featuresKo);

                    });

                }, function(e) {
                    debugger;
                });

                self.map.addLayer(self.layers.analysisArea);


                //on.once(self.map, 'layers-add-result', function (layersAddResult) {
                //    debugger;
                //    var promises = [];
                //    layersAddResult.layers.forEach(function (addedLayer) {
                //        aoi.layers[addedLayer.layer.id] = addedLayer.layer;
                //        var query = new Query()
                //        query.outSpatialReference = self.map.spatialReference;
                //        on(addedLayer.layer, 'click', onLayerClick);
                //        promises.push(addedLayer.layer.queryFeatures(query));
                //    });

                //    all(promises).then(function (featureSets) {
                //        //extract all features
                //        var features = [],
                //            unionOfExtents,
                //            featuresKo = [];
                //        featureSets.forEach(function (featureSet) {
                //            features = features.concat(featureSet.features);
                //        });

                //        //union extents, but only those with actual extents
                //        for (var i = 0; i < features.length; i++) { //todo switch to foreach; this way to simplify debugging
                //            var feature = features[i],
                //                geometry = feature.geometry,
                //                featureKO = self._constructFeature(feature),
                //                extent;
                //            featuresKo.push(featureKO);
                //            if (geometry) {
                //                if (geometry.type === 'point') {
                //                    extent = new Extent(geometry.x, geometry.x, geometry.y, geometry.y, geometry.spatialReference);
                //                } else {
                //                    extent = geometry.getExtent();
                //                }
                //                if (extent) {
                //                    unionOfExtents = unionOfExtents ? unionOfExtents.union(extent) : extent;
                //                }
                //            }
                //        }
                //        if (unionOfExtents) {
                //            //todo this fails if there's just one point. See zoomToFeature 
                //            unionOfExtents = unionOfExtents.expand(1.5);
                //            topic.publish('layerLoader/zoomToExtent', extent);
                //        }

                //        aoi.features(featuresKo);
                //    });



                //});


                    //todo remove layers from other aois

                    //sync clinking graphics in map with features



                //when all promises to query are resolved, we get the features, knockoutify them, union extents, zoom map, 
            },

            //constructs a feature either from a draw-end event, or when loading from server
            //

            _constructFeature: function (featureOrEvent) {
                if (!featureOrEvent) return null;
                var self = this,
                    type = featureOrEvent.geometry.type,
                    aoi = self.currentAoi(),
                    feature = {
                        name: (featureOrEvent.attributes ? featureOrEvent.attributes.FEATURE_NAME : 'Feature ' + this._nextFeatureNumber()),
                        bufferDistance: featureOrEvent.attributes && featureOrEvent.attributes.BUFFER_DISTANCE ? featureOrEvent.attributes.BUFFER_DISTANCE : self.lastBufferDistance,
                        bufferUnit: featureOrEvent.attributes && featureOrEvent.attributes.BUFFER_DISTANCE_UNITS ? self.bufferUnits[featureOrEvent.attributes.BUFFER_DISTANCE_UNITS.toLowerCase()] : null || self.lastUnit, //TODO cache the last-entered unit
                        analysisAreaId: featureOrEvent.attributes && featureOrEvent.attributes.FK_PROJECT_ALT ? featureOrEvent.attributes.FK_PROJECT_ALT : null,
                        type: type,
                        geometry: featureOrEvent.geometry,
                        graphic: featureOrEvent.attributes ? featureOrEvent : new Graphic(featureOrEvent.geometry)
                        //graphicsLayer: type === 'point' ? self.pointGraphics : type === 'polyline' ? self.polylineGraphics : type === 'polygon' ? self.polygonGraphics : null
                    };

                //back-reference, supports clicking map or model
                feature.graphic.feature = feature;
                
                if (!featureOrEvent.attributes) {
                    //result from draw-end event, construct attributes
                    feature.graphic.attributes = {
                        OBJECTID: null,
                        BUFFER_DISTANCE: self.lastBufferDistance,
                        BUFFER_DISTANCE_UNITS: self.lastUnit.name,
                        FEATURE_NAME: feature.name,
                        FK_PROJECT: aoi.id
                    }
                }

                //tie to S_AOI record
                if (feature.analysisAreaId) {
                    var analysisArea = { id: feature.analysisAreaId, name: null },
                        analysisAreaFeature = self.layers.analysisArea.graphics.find(function (aaf) {
                            return aaf.attributes.FK_PROJECT_ALT === analysisArea.id;
                        });
                    if (analysisAreaFeature) {
                        analysisArea.name = analysisAreaFeature.attributes.FEATURE_NAME;
                    } else {
                        analysisArea.name = feature.graphic.attributes.FK_PRJ_ALT; //punt
                    }
                    //name might still be null (only during development, really, when our FK constraints are disabled)
                    if (analysisArea.name) {
                        self._addFeatureToAnalysisArea(analysisArea);
                    }
                }

                /* eslint-disable no-undef */
                feature.name = ko.observable(feature.name);
                feature.bufferDistance = ko.observable(feature.bufferDistance);
                feature.bufferUnit = ko.observable(feature.bufferUnit);
                feature.bufferText = ko.pureComputed(function () {
                    if (feature.bufferDistance() > 0 && feature.bufferUnit()) {
                        return feature.bufferDistance() + ' ' + feature.bufferUnit().abbreviation;
                    }
                    return '-';
                });
                feature.analysisArea = ko.observable(feature.analysisArea);
                feature.selected = ko.pureComputed(function () {
                    return self.currentAoi() && self.currentAoi().currentFeature() === feature;
                });
                //happens when user clicks on a feature in the table of features, but not when clicking on the map;
                //a different function handles that, but doesn't include the zoom/pan
                feature.select = function () {
                    if (self.currentAoi()) {
                        self.currentAoi().currentFeature(feature);
                        //todo zoom/pan if not in current extent
                        var geometry = feature.graphic ? feature.graphic.geometry : { getExtent: function () { return null } }, //pseudo object with null extent
                            testExtent = feature.type === 'point' ? geometry : geometry.getExtent(); //contains method expects a point or an extent
                        //project, our features are stored in 3087, needs to be in 3857/102100, which makes no sense
                        //debugger;
                        if (testExtent && !self.map.extent.contains(testExtent)) {
                            if (feature.type === 'point') {
                                //center at
                                self.map.centerAt(testExtent);
                            } else {
                                //zoom to buffer around extent
                                self.map.setExtent(testExtent.expand(2));
                            }
                        }
                    }
                };

                feature.bufferDistance.subscribe(function(newValue) {
                    self.bufferFeature(feature);
                    feature.graphic.attributes.BUFFER_DISTANCE = newValue;
                    if (newValue) {
                        self.lastBufferDistance = newValue;
                    }
                    feature.updateDatabase();
                },"changed");

                feature.bufferUnit.subscribe(function(newValue) {
                    self.bufferFeature(feature);
                    feature.graphic.attributes.BUFFER_DISTANCE_UNITS = newValue.name;
                    if (newValue) {
                        self.lastUnit = newValue;
                    }
                    feature.updateDatabase();
                },"changed");


                feature.name.subscribe(function(newValue) {
                    feature.graphic.attributes.FEATURE_NAME = newValue;
                    feature.updateDatabase();
                },'changed');

                feature.updateDatabase = function() {
                    var graphic = feature.graphic,
                        layer = graphic._layer;
                    layer.applyEdits(null, [graphic], null, function(a,u,d) {
                        //debugger;
                    }, function(e) {
                        debugger;
                    });
                    //todo add to undo stack
                };

                feature.delete = function () {
                    //todo confirm?
                    //todo add to undo stack
                    var graphic = feature.graphic,
                        layer = graphic._layer,
                        buffer = feature.buffer;
                    if (buffer) {
                        self.bufferGraphics.remove(buffer);
                    }
                    layer.applyEdits(null, null, [graphic], function (a, u, d) {
                        self.currentAoi().features.remove(feature);
                        delete feature;
                    }, function (e) {
                        debugger;
                    });
                    //TODO delete from features collection?
                    //now or after callback?
                };
                //no add function, handled elsewhere

                /* eslint-enable no-undef */
                //buffer it
                self.bufferFeature(feature);


                return feature;
            },

            _addFeatureToAnalysisArea: function (feature, analysisArea) {
                //if analysis area is null, nothing to do
                if (!analysisArea) {
                    return null;
                }
                if (typeof analysisArea === 'string') {
                    //first check to see if it exists
                    var existingGroup = ko.utils.arrayFirst(this.currentAoi().analysisAreas(), function (ag) {
                        return ag.name() === analysisArea;
                    });
                    if (existingGroup) {
                        analysisArea = existingGroup;
                    } else {
                        analysisArea = {
                            name: ko.observable(analysisArea), //observable so that user can rename it
                            buffer: null //doesn't need to be observable
                        };
                        analysisArea.features = ko.pureComputed(function () {
                            return ko.utils.arrayFilter(this.currentAoi().features(), function (f) {
                                return f.analysisArea() === analysisArea;
                                });
                        }, this);
                    }
                }
                feature.analysisArea(analysisArea);
                //todo update buffer
                return analysisArea;
            },

            listAois: function (orgId, includeExpired) {
                //todo DWR call to get list of AOIs with basic properties of  id, name, type and description
                //eslint-disable-next-line no-undef
                MapDAO.getAreaOfInterestList(orgId, includeExpired, {
                    callback: function (aois) {
                        debugger;
                    },
                    errorHandler: function (message, exception) {
                        topic.publish('viewer/handleError', {
                            source: 'AoiEditor.listAois',
                            error: 'Error message is: ' + message + ' - Error Details: ' + dwr.util.toDescriptiveString(exception, 2) //eslint-disable-line no-undef
                        });
                        if (savedMap.deferred) {
                            savedMap.deferred.reject(message);
                        }
                    }
                });
            },

            simplifyGeometry: function (geometry) {
                var deferred;
                if (geometry) {
                    if (geometry.type === 'polygon') {
                        deferred = esriConfig.defaults.geometryService.simplify([geometry]);
                    } else {
                        //todo do we need to simplify polylines?
                        deferred = new Deferred();
                        window.setTimeout(function () {
                            deferred.resolve([geometry]);
                        }, 100);
                    }
                } else {
                    deferred = new Deferred();
                    window.setTimeout(function () {
                        deferred.reject('Missing geometry, unable to simplify.');
                    }, 100);
                }
                return deferred;                            
            },

            /**
             * Creates a buffer around the referenced feature. If buffer distance is set to 0, no buffer is created. 
             * Called after creating a new feature, modifying an existing feature (moving vertices, etc.), or changing the
             * feature's buffer distance or buffer distance units.
             * @param {any} feature The feature object to be buffered.
             * @returns {Deffered} A Deffered object that is resolved when the buffer is created, passing a reference to the buffer graphic if it can be created.
             */
            bufferFeature: function (feature) {
                var self = this, //closures because "this" changes context in callbacks; self is the AoiEditor
                    geometry = feature.graphic ? feature.graphic.geometry : null,
                    buffer = feature.buffer,
                    deferred = new Deferred();
                
                if (buffer) {
                    self.bufferGraphics.remove(buffer);
                    feature.buffer = null;
                }

                if (geometry && feature.bufferDistance() > 0) {
                    //first, simplify polygons
                    //seems to be always necessary
                    this.simplifyGeometry(geometry).then(
                        function (simplifiedGeometries) {
                            var params = new BufferParameters();

                            params.distances = [feature.bufferDistance()];
                            params.outSpatialReference = self.map.spatialReference;
                            params.unit = feature.bufferUnit().id;
                            params.geometries = simplifiedGeometries; //We're only doing one at a time, but buffer expects an array. 

                            esriConfig.defaults.geometryService.buffer(params,
                                function (bufferedGeometries) {
                                    //we don't really need forEach here, we just have one...for now
                                    //bufferedGeometries.forEach(function (bufferedGeometry) {
                                    var bufferedGeometry = bufferedGeometries[0],
                                        graphic = new Graphic(bufferedGeometry);
                                    graphic.feature = feature; //cross-reference from buffer is to the feature it is a buffer of
                                    feature.buffer = graphic;
                                    self.bufferGraphics.add(graphic);
                                    deferred.resolve(graphic);
                                    //});
                                },
                                function (err) {
                                    deferred.reject(err);
                                });
                        },
                        function (err) {
                            deferred.reject(err);
                        });
                } else {
                    //buffer distance set to 0, or no geometry, delete the buffer
                    feature.buffer = null;
                    deferred.resolve(null);
                }
                return deferred;
            },

            _knockoutifyAoiEditor: function () {
                /* eslint-disable no-undef */
                this.aois = ko.observable();
                this.currentAoi = ko.observable();
                this.filterAois = ko.observable(false);

                this._nextFeatureNumber = ko.pureComputed(function () {
                    var n = 0,
                        rx = /(\d+)/;
                    if (this.currentAoi()) {
                        ko.utils.arrayForEach(this.currentAoi().features(), function (f) {
                            var r = rx.exec(f.name());
                            if (r) {
                                //convert string to number
                                r = parseInt(r[0], 10);
                                if (r > n) {
                                    n = r;
                                }
                            }
                        });
                    }
                    n++;
                    return n;
                }, this);

                //apply knockout bindings
                ko.applyBindings(this, dom.byId('aoiEditorSidebar'));

                /* eslint-enable no-undef */

            },

            ////mostly not used, 
            _createGraphicLayers: function () {
                var self = this;
            //    // points
            //    this.pointGraphics = new GraphicsLayer({
            //        id: this.id + '_Points',
            //        title: this.id + ' Points'
            //    });

            //    // polyline
            //    this.polylineGraphics = new GraphicsLayer({
            //        id: this.id + '_Lines',
            //        title: this.id + ' Lines'
            //    });

            //    // polygons
            //    this.polygonGraphics = new GraphicsLayer({
            //        id: this.id + '_Polygons',
            //        title: this.id + ' Polygons'
            //    });

                // buffers
                this.bufferGraphics = new GraphicsLayer({
                    id: this.id + '_Buffers',
                    title: this.id + ' Buffers'
                });

            //    this.map.addLayer(this.polygonGraphics);
            //    this.map.addLayer(this.polylineGraphics);
            //    this.map.addLayer(this.pointGraphics);
                this.map.addLayer(this.bufferGraphics);

                var f = function (evt) {
                    //subscription on currentFeature does this edit.activate(2, evt.graphic);
                    if (self.currentAoi() && evt.graphic && evt.graphic.feature) {
                        event.stopPropagation(evt);
                        self.currentAoi().currentFeature(evt.graphic.feature);
                    }
                }

            //    on(this.pointGraphics, 'click', f);
            //    on(this.polylineGraphics, 'click', f);
            //    on(this.polygonGraphics, 'click', f);
                on(this.bufferGraphics, 'click', f);

            //    this._createGraphicLayersRenderers();
            //},
            //_createGraphicLayersRenderers() {
            //    //create renderers
            //    var markerSymbol = new SimpleMarkerSymbol({
            //        style: 'esriSMSCircle',
            //        color: [0, 255, 197, 127],
            //        size: 5,
            //        outline: {
            //            color: [0, 255, 197, 255],
            //            width: 0.75
            //        }
            //    });
            //    var pointRenderer = new SimpleRenderer(markerSymbol);
            //    this.pointGraphics.setRenderer(pointRenderer);

            //    var polylineSymbol = new SimpleLineSymbol({
            //        style: 'esriSLSSolid ',
            //        color: [0, 255, 197, 255],
            //        width: 1
            //    });
            //    var polylineRenderer = new SimpleRenderer(polylineSymbol);
            //    this.polylineGraphics.setRenderer(polylineRenderer);

            //    var fillSymbol = new SimpleFillSymbol({
            //        style: 'esriSFSSolid',
            //        color: [0, 255, 197, 63],
            //        outline: {
            //            style: 'esriSLSSolid ',
            //            color: [0, 255, 197, 255],
            //            width: 0.75
            //        }
            //    });
            //    var polygonRenderer = new SimpleRenderer(fillSymbol);
            //    this.polygonGraphics.setRenderer(polygonRenderer);

                var bufferSymbol = new SimpleFillSymbol({
                    style: 'esriSFSSolid',
                    color: [0, 115, 76, 63],
                    outline: {
                        style: 'esriSLSDash',
                        color: [0, 115, 76, 255],
                        width: 0.75
                    }
                });
                var bufferRenderer = new SimpleRenderer(bufferSymbol);
                this.bufferGraphics.setRenderer(bufferRenderer);

            //    //todo separate symbols for "active" feature? If/when switching from using graphics/graphicslayers to storing features, the selectionSymbol would be the way to go.
            }
        });
    });