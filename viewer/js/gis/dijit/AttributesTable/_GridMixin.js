define([
    'dojo/_base/declare',
    'dojo/_base/lang',
    'dojo/topic',
    'dojo/sniff',
    'dojo/_base/array',
    'dojo/date/locale',
    'dojo/number',

    'dstore/Memory',

    'dgrid1/Grid', // http://dojofoundation.org/packages/dgrid/
    'dgrid1/Selector',
    'dgrid1/Keyboard',
    'dgrid1/Editor',
    'dgrid1/extensions/ColumnHider',
    'dgrid1/extensions/ColumnReorder',
    'dgrid1/extensions/ColumnResizer',
    'dgrid1/extensions/Pagination',

    'xstyle/css!dgrid1/css/dgrid.css'

], function (
    declare,
    lang,
    topic,
    has,
    array,
    locale,
    number,

    Memory,

    Grid,
    Selector,
    Keyboard,
    Editor,
    ColumnHider,
    ColumnReorder,
    ColumnResizer,
    Pagination
) {

    return declare(null, {

        gridOptions: {},

        defaultGridOptions: {

            minWidth: 70,

            // no columns, use fields from Query's returned features
            columns: [],

            // no sort
            sort: [],

            // populate the grid with field Coded Domain instead of raw value code
            useCodedDomainValues: true,

            // Allow the user to enable the editor in the grid
            editor: true,

            // Allow the user to use column sets in grid
            columnSet: false,

            // Allow the user to hide columns in grid
            columnHide: true,

            // Allow the user to reorder columns in grid
            columnReorder: true,

            // Allow the user to resize columns in grid
            columnResize: true,

            // Use pagination on the results grid
            pagination: true,

            paginationOptions: {
                rowsPerPage: 100,
                previousNextArrows: true,
                firstLastArrows: true,
                pagingLinks: 2,
                pagingTextBox: true,
                pageSizeOptions: [10, 25, 50, 100, 250, 500, 1000],
                showLoadingMessage: true
            },

            // optional user-defined column formatters
            formatters: {},

            // optional user-defined column getters
            getters: {}
        },

        // column formatters
        formatters: {},
        defaultFormatters: {
            date: function (value) {
                var date = new Date(value);
                return locale.format(date, {
                    selector: 'date',
                    formatLength: 'medium'
                });
            },

            dateTime: function (value) {
                var date = new Date(value);
                return locale.format(date, {
                    formatLength: 'short'
                });
            },

            number: function (value) {
                return number.format(value);
            },

            double: function (value) {
                return number.format(value, {
                    places: 3
                });
            },

            /**
             * converts a string to a nice sentence case format
             * @url http://stackoverflow.com/questions/196972/convert-string-to-title-case-with-javascript
             * @param  {string} str The string to convert
             * @return {string}     The converted string
             */
            makeSentenceCase: function (str) {
                if (!str.length) {
                    return '';
                }
                str = str.toLowerCase().replace(/_/g, ' ').split(' ');
                for (var i = 0; i < str.length; i++) {
                    str[i] = str[i].charAt(0).toUpperCase() + (str[i].substr(1).length ? str[i].substr(1) : '');
                }
                return (str.length ? str.join(' ') : str);
            }

        },

        // column getters
        getters: {},
        defaultGetters: {
            layerName: function () {
                return this.getLayerName();
            },

            dateTime: function (value) {
                if (isNaN(value) || value === 0 || value === null) {
                    return null;
                }
                return new Date(value);
            }
        },

        getGridConfiguration: function (options) {
            this.gridOptions = this.mixinDeep(lang.clone(this.defaultGridOptions), options);
            this.formatters = lang.mixin(lang.clone(this.defaultFormatters), this.gridOptions.formatters);
            this.getters = lang.mixin(lang.clone(this.defaultGetters), this.gridOptions.getters);
        },

        createGrid: function () {
            if (!this.grid) {
                var gridOptions = {
                    cellNavigation: false,
                    showHeader: true,
                    showFooter: true,
                    addUiClasses: false,
                    collection: new Memory(),
                    columns: [],
                    sort: []
                };

                var options = this.gridOptions || {};

                // grid and mixins
                var req = [Grid, Keyboard];
                if (this.featureOptions.selected !== false) {
                    req.push(Selector);
                    gridOptions.selectionMode = has('touch') ? 'toggle' : 'extended';
                    gridOptions.allowFeatureSelectionAll = true;
                }

                // hack to show all records when there is no pagination
                if (options.pagination !== true) {
                    options.paginationOptions.rowsPerPage = 999999;
                }
                req.push(Pagination);
                lang.mixin(gridOptions, options.paginationOptions);

                if (options.editor !== false) {
                    req.push(Editor);
                }

                // grid extensions
                if (options.columnHide !== false) {
                    req.push(ColumnHider);
                }
                if (options.columnReorder !== false) {
                    req.push(ColumnReorder);
                }
                if (options.columnResize !== false) {
                    req.push(ColumnResizer);
                }

                var AttributeGrid = declare(req);
                this.grid = new AttributeGrid(gridOptions, this.attributesTableGridDijit.domNode);
                this.grid.startup();

                // don't show the footer when there is no pagination
                if (options.pagination !== true) {
                    this.grid.set('showFooter', false);
                }

                if (this.featureOptions.selected) {
                    this.grid.on('dgrid-select', lang.hitch(this, 'selectFeaturesFromGrid'));
                    this.grid.on('dgrid-deselect', lang.hitch(this, 'selectFeaturesFromGrid'));
                }
            }

        },

        populateGrid: function (options) {
            var features = null,
                results = options;
            if (options.results) {
                results = options.results;
            } else {
                options = null; // no options when it is also the results
            }

            if (!this.results) {
                this.results = results;
                features = this.getFeaturesFromResults();
            } else {
                features = this.getFeatures();
            }
            if (!this.idProperty) {
                this.getIdProperty(results);
            }

            /* apparently not used
            var delim = '', linkField = this.linkField;
            var filteredFields = array.filter(results.fields, function (field) {
                return (field.name === linkField);
            });
            if (filteredFields.length > 0) {
                if (filteredFields[0].type === 'esriFieldTypeString') {
                    delim = '\'';
                }
            }
            */

            var rows = [];

            array.forEach(features, lang.hitch(this, function (feature) {
                // relationship query
                if (feature.relatedRecords) {
                    rows = rows.concat(this.getRelatedRecords(feature));

                // spatial or table query
                } else if (feature.attributes) {
                    rows = rows.concat(this.getRecordFromFeature(feature));
                }
            }));

            if (this.toolbarOptions.zoom.show) {
                this.zoomToFeatureGraphics();
            }

            this.getColumnsAndSort(results, options);

            if (rows && rows.length > 0) {
                var store = new Memory({
                    idProperty: this.idProperty,
                    data: rows
                });
                this.grid.set('collection', store);
            }

            // refresh only needs with IE?
            if (has('ie')) {
                this.grid.refresh();
            }
            this.setToolbarButtons();

        },

        getRecordFromFeature: function (feature) {
            var rows = [], delim = '';
            var lq = null;
            if (this.hasLinkedQuery()) {
                lq = this.linkedQuery;
            }

            var showFeatures = this.featureOptions.features;
            if (!lq || lq.type !== 'table') {
                var row = feature.attributes;
                if (this.gridOptions.useCodedDomainValues) {
                    row = this.getCodedDomainValues(row);
                }
                if (this.getColumn('layerName') && !row.layerName) {
                    row.layerName = this.getLayerName();
                }
                // add reference to the feature if there is geometry
                if (showFeatures && feature.geometry) {
                    row.feature = lang.clone(feature);
                }
                if (lq && lq.linkIDs) {
                    lq.linkIDs.push(delim + feature.attributes[this.linkField] + delim);
                }
                rows.push(row);

                if (showFeatures && feature.geometry) {
                    this.addFeatureGraphic(feature);
                }
            }
            return rows;
        },

        getRelatedRecords: function (feature) {
            var rows = [], delim = '', objectID = feature.objectId;
            var lq = null;
            if (this.hasLinkedQuery()) {
                lq = this.linkedQuery;
            }

            var showFeatures = this.featureOptions.features;
            // multiple related records for a feature
            array.forEach(feature.relatedRecords, lang.hitch(this, function (record) {
                if (record.attributes) {
                    var row = record.attributes;
                    row.RelatedObjectID = objectID;
                    rows.push(row);
                }
                if (lq && lq.linkIDs) {
                    lq.linkIDs.push(delim + feature.attributes[this.linkField] + delim);
                }
                if (showFeatures && record.geometry) {
                    this.addFeatureGraphic(feature);
                }
            }));
            return rows;
        },

        getCodedDomainValues: function (attributes) {
            var k = null, len = null;
            var layer = this.getQueryTaskLayerJSON();

            if (layer && layer.fields) {
                for (var fieldName in attributes) {
                    if (attributes.hasOwnProperty(fieldName)) {

                        var field = null, fields = layer.fields;
                        len = fields.length;
                        for (k = 0; k < len; k++) {
                            if (fieldName === fields[k].name) {
                                field = fields[k];
                                if (field) {
                                    var codedValueDomain = field.domain;
                                    if (codedValueDomain && codedValueDomain.type === 'codedValue') {

                                        var codedValues = codedValueDomain.codedValues;
                                        len = codedValues.length;
                                        for (k = 0; k < len; k++) {
                                            var codedValue = codedValues[k];
                                            if (attributes[fieldName] === codedValue.code) {
                                                attributes[fieldName] = codedValue.name;
                                            }
                                        }
                                    }
                                }
                            }
                        }

                    }
                }
            }

            return attributes;

        },

        getLayerName: function () {
            var layer = this.getQueryTaskLayerJSON();
            if (layer) {
                return layer.name;
            }
            return '';
        },

        getColumnsAndSort: function (results, options) {
            if (options) {
                // reset the columns?
                if (options.columns) {
                    this.gridOptions.columns = options.columns;
                }

                // reset the sort?
                if (options.sort) {
                    this.gridOptions.sort = options.sort;
                }
            }

            // set the columns
            var columns = lang.clone(this.gridOptions.columns) || [];
            // no columns? get them from the fields
            if (!columns || columns.length < 1) {
                columns = this.buildColumns(results);
            }

            if (columns) {
                columns = this.setFormattersAndGetters(columns);
                this.setColumnStyles(columns);
                this.grid.set('columns', columns);
            } else if (this.gridOptions.subRows) {
                this.grid.set('subRows', this.gridOptions.subRows);
            }

            // set the sort
            var sort = this.gridOptions.sort || [];
            // sort === 'inherit'? use query result order
            if (typeof sort === 'string' && sort.toLowerCase() === 'inherit') {
                return;
            }
            // no sort? use the first column
            if (sort.length < 1 && columns && columns.length > 0) {
                sort = [
                    {
                        property: columns[0].field,
                        descending: false
                    }
                ];
            } else {
                // replace 'attribute' with 'property'.
                // needed to handle old configurations with new dgrid 1.x
                array.forEach(sort, function (item) {
                    if (item.attribute && !item.property) {
                        item.property = item.attribute;
                        delete item.attribute;
                    }
                });
            }
            this.grid.set('sort', sort);
        },

        buildColumns: function (results) {
            var excludedFields = ['objectid', 'esri_oid', 'shape', 'shape.len', 'shape.area', 'shape.starea()', 'shape.stlength()', 'st_area(shape)', 'st_length(shape)'];
            var columns = [],
                col = null,
                nameLC = null;

            if (results.fields) {
                array.forEach(results.fields, lang.hitch(this, function (field) {
                    nameLC = field.name.toLowerCase();
                    if (array.indexOf(excludedFields, nameLC) < 0) {
                        var alias = field.alias;
                        if (alias === field.name) {
                            alias = this.formatters.makeSentenceCase(alias);
                        }
                        col = {
                            id: field.name,
                            field: field.name,
                            label: alias,
                            style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
                            width: 100
                        };
                        switch (field.type) {
                        case 'esriFieldTypeString':
                            col.width = 150;
                            break;
                        case 'esriFieldTypeSmallInteger':
                        case 'esriFieldTypeInteger':
                            col.formatter = 'number';
                            col.style += 'text-align:right;';
                            break;
                        case 'esriFieldTypeSingle':
                        case 'esriFieldTypeDouble':
                            col.formatter = 'double';
                            col.style += 'text-align:right;';
                            break;
                        case 'esriFieldTypeDate':
                            col.width = 150;
                            col.formatter = 'dateTime';
                            break;
                        default:
                            break;
                        }
                        columns.push(col);
                    }
                }));
            } else if (this.getFeatureCount() > 0) {
                var feature = this.features[0];
                if (feature) {
                    var attributes = feature.attributes;
                    for (var key in attributes) {
                        if (attributes.hasOwnProperty(key)) {
                            columns.push({
                                id: key,
                                field: key,
                                label: this.formatters.makeSentenceCase(key),
                                width: 100
                            });
                        }
                    }
                }
            }
            return columns;
        },

        setFormattersAndGetters: function (columns) {
            array.forEach(columns, lang.hitch(this, function (column) {
                if (typeof column.formatter === 'string') {
                    if (this.formatters && this.formatters[column.formatter]) {
                        column.formatter = lang.hitch(this, this.formatters[column.formatter]);
                    } else {
                        delete column.formatter;
                    }
                }
                if (typeof column.get === 'string') {
                    if (this.getters && this.getters[column.get]) {
                        column.get = lang.hitch(this, this.getters[column.get]);
                    } else {
                        delete column.get;
                    }
                }
            }));
            return columns;
        },

        setColumnStyles: function (columns) {
            //style the grid columns from the config object
            var gr = this.grid;
            array.forEach(columns, function (column) {
                if (column.style) {
                    gr.styleColumn(column.id, column.style);
                }
            });
        },

        selectFeaturesFromGrid: function () {
            var selection = this.grid.get('selection'),
                feature = null;

            this.selectedFeatures = [];
            this.selectedGraphics.clear();

            for (var key in selection) {
                if (selection.hasOwnProperty(key) && selection[key] === true) {
                    feature = this.getFeatureFromStore(key);
                    if (feature && feature.geometry) {
                        this.addSelectedGraphic(feature);
                    }
                }
            }
            this.doneSelectingFeatures(true);
        },

        getFeatureFromStore: function (key) {
            var collection = this.grid.get('collection'),
                rec = null,
                feature = null;
            rec = collection.getSync(key);
            if (rec) {
                feature = rec.feature;
            }
            return feature;

        },

        getColumn: function (columnID) {
            var columns = lang.clone(this.gridOptions.columns) || [];
            var columnFound = array.filter(columns, function (column) {
                return (column.field === columnID);
            });
            return (columnFound.length > 0) ? columnFound[0] : null;
        },

        clearGrid: function () {
            if (this.grid) {
                if (this.grid.clearSelection) {
                    this.grid.clearSelection();
                }
                this.grid.set('columns', []);
                this.grid.set('collection', new Memory());
                this.grid.refresh();
            }
            this.setToolbarButtons();
            topic.publish(this.attributesContainerID + '/tableUpdated', this);
        },

        clearSelectedGridRows: function () {
            if (!this.grid) {
                return null;
            }

            var collection = this.grid.get('collection');
            var selection = lang.clone(this.grid.get('selection'));

            if (!selection || !collection || !collection.data) {
                return null;
            }

            for (var key in selection) {
                if (selection.hasOwnProperty(key) && selection[key] === true) {
                    collection.removeSync(key);
                }
            }

            this.grid.refresh();

            return {selection: selection, idProperty: this.idProperty};
        },

        showOnlySelectedGridRows: function () {
            if (!this.grid) {
                return null;
            }

            var collection = this.grid.get('collection');
            var selection = lang.clone(this.grid.get('selection'));

            var toKeep = [];

            if (!selection || !collection || !collection.data) {
                return null;
            }

            for (var key in selection) {
                if (selection.hasOwnProperty(key) && selection[key] === true) {
                    toKeep.push(lang.clone(collection.getSync(key)));
                }
            }

            collection.setData(toKeep);

            this.grid.refresh();

            return {selection: selection, idProperty: this.idProperty};
        }
    });
});
