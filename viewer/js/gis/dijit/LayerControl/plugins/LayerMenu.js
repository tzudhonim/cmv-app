define([
    'dojo/_base/declare',
    'dijit/Menu',
    'dijit/MenuItem',
    'dijit/PopupMenuItem',
    'dijit/MenuSeparator',
    './Transparency',
    'dojo/i18n!./../nls/resource'
], function (
    declare,
    Menu,
    MenuItem,
    PopupMenuItem,
    MenuSeparator,
    Transparency,
    i18n
) {
    return declare(Menu, {
        control: null,
        _removed: false, //for future use
        postCreate: function () {
            this.inherited(arguments);
            var control = this.control,
                layer = control.layer,
                controlOptions = control.controlOptions,
                controller = control.controller,
                layerType = control._layerType,
                self = this;
            //reorder menu items
            if ((layerType === 'vector' && controller.vectorReorder) || (layerType === 'overlay' && controller.overlayReorder)) {
                control._reorderUp = new MenuItem({
                    label: i18n.moveUp,
                    iconClass: 'fas fa-fw fa-sort-up',
                    onClick: function () {
                        controller._moveUp(control);
                    }
                });
                self.addChild(control._reorderUp);
                control._reorderDown = new MenuItem({
                    label: i18n.moveDown,
                    iconClass: 'fas fa-fw fa-sort-down',
                    onClick: function () {
                        controller._moveDown(control);
                    }
                });
                self.addChild(control._reorderDown);
                self.addChild(new MenuSeparator());
            }
            // toggle all dynamic sublayers
            if (control._dynamicToggleMenuItems) {
                control._dynamicToggleMenuItems(self);
            }
            //zoom to layer
            if ((controlOptions.noZoom !== true && controller.noZoom !== true) || (controller.noZoom === true && controlOptions.noZoom === false)) {
                control._zoomTo = new MenuItem({
                    label: i18n.zoomTo,
                    iconClass: 'fas fa-fw fa-search',
                    onClick: function () {
                        controller._zoomToLayer(layer);
                    }
                });
                self.addChild(control._zoomTo);
            }
            //transparency
            if ((controlOptions.noTransparency !== true && controller.noTransparency !== true) || (controller.noTransparency === true && controlOptions.noTransparency === false)) {
                self.addChild(new Transparency({
                    label: i18n.transparency,
                    iconClass: 'fas fa-fw fa-adjust',
                    layer: layer
                }));
            }
            //layer swipe
            if (controlOptions.swipe === true || (controller.swipe === true && controlOptions.swipe !== false)) {
                var swipeMenu = new Menu();
                swipeMenu.addChild(new MenuItem({
                    label: i18n.layerSwipeVertical,
                    iconClass: 'fas fa-fw fa-sort fa-rotate-90',
                    onClick: function () {
                        controller._swipeLayer(layer, 'vertical');
                    }
                }));
                swipeMenu.addChild(new MenuItem({
                    label: i18n.layerSwipeHorizontal,
                    iconClass: 'fas fa-fw fa-sort',
                    onClick: function () {
                        controller._swipeLayer(layer, 'horizontal');
                    }
                }));
                if (controlOptions.swipeScope === true) {
                    swipeMenu.addChild(new MenuItem({
                        label: i18n.layerSwipeScope,
                        iconClass: 'fas fa-fw fa-circle',
                        onClick: function () {
                            controller._swipeLayer(layer, 'scope');
                        }
                    }));
                }
                self.addChild(new PopupMenuItem({
                    label: i18n.layerSwipe,
                    iconClass: 'fas fa-fw fa-sort',
                    popup: swipeMenu
                }));
            }
            // metadata link
            // service url
            if (controlOptions.metadataUrl === true && layer.url) {
                self.addChild(new MenuSeparator());
                self.addChild(new MenuItem({
                    label: i18n.metadata,
                    iconClass: 'fas fa-fw fa-info-circle',
                    onClick: function () {
                        window.open(layer.url, '_blank');
                    }
                }));
            }
            // custom url
            if (controlOptions.metadataUrl && typeof controlOptions.metadataUrl === 'string') {
                self.addChild(new MenuSeparator());
                self.addChild(new MenuItem({
                    label: i18n.metadata,
                    iconClass: 'fas fa-fw fa-info-circle',
                    onClick: function () {
                        window.open(controlOptions.metadataUrl, '_blank');
                    }
                }));
            }
            // remove
            if (controlOptions.allowRemove) {
                self.addChild(new MenuSeparator());
                self.addChild(new MenuItem({
                    label: i18n.remove,
                    iconClass: 'fas fa-fw fa-minus-circle',
                    onClick: function () {
                        controller._removeLayer(layer);
                    }
                }));
            }
            //if last child is a separator remove it
            var lastChild = self.getChildren()[self.getChildren().length - 1];
            if (lastChild && lastChild.isInstanceOf(MenuSeparator)) {
                self.removeChild(lastChild);
            }
        }
    });
});
