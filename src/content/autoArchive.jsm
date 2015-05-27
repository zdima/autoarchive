// Opera Wang, 2013/5/1
// GPL V3 / MPL
"use strict";
var EXPORTED_SYMBOLS = ["autoArchive"];
const { classes: Cc, Constructor: CC, interfaces: Ci, utils: Cu, results: Cr, manager: Cm } = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource:///modules/mailServices.js");
Cu.import("resource://app/modules/gloda/utils.js");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("chrome://awsomeAutoArchive/content/log.jsm");
Cu.import("chrome://awsomeAutoArchive/content/aop.jsm");
Cu.import("chrome://awsomeAutoArchive/content/autoArchiveService.jsm");
Cu.import("chrome://awsomeAutoArchive/content/autoArchivePref.jsm");
Cu.import("chrome://awsomeAutoArchive/content/autoArchiveUtil.jsm");
Cu.import("chrome://awsomeAutoArchive/content/autoArchivePrefDialog.jsm");
Cu.import("chrome://awsomeAutoArchive/content/autoArchiveActivity.jsm");

const XULNS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const statusbarIconID = "autoArchive-statusbar-icon";
const popupsetID = "autoArchive-statusbar-popup";
const contextMenuID = "autoArchive-statusbar-contextmenu";
const mailContextMenuID = "autoArchive-create-rule-contextmenuitem";
const contextMenuScheduleID = "autoArchive-statusbar-contextmenu-schedule";
const statusbarIconSrc = 'chrome://awsomeAutoArchive/content/icon.png';
const statusbarIconSrcWait = 'chrome://awsomeAutoArchive/content/icon_wait.png';
const statusbarIconSrcRun = 'chrome://awsomeAutoArchive/content/icon_run.png';

let autoArchive = {
  strBundle: Services.strings.createBundle('chrome://awsomeAutoArchive/locale/awsome_auto_archive.properties'),
  Load: function(aWindow) {
    if ( typeof(aWindow._autoarchive) != 'undefined' ) return autoArchiveLog.info("Already loaded, return");
    aWindow._autoarchive = { createdElements:[], hookedFunctions:[], contextMenuItem: null, timer: Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer) };
    aWindow._autoarchive.timer.initWithCallback( function() { // can be function, or nsITimerCallback
      autoArchive.realLoad(aWindow);
    }, 0, Ci.nsITimer.TYPE_ONE_SHOT );
    //return autoArchive.realLoad(aWindow);
  },

  realLoad: function(aWindow) {
    try {
      autoArchiveLog.info("Load for " + aWindow.location.href);
      let doc = aWindow.document;
      //let winref = Cu.getWeakReference(aWindow);
      //let docref = Cu.getWeakReference(doc);
      let status_bar = doc.getElementById('status-bar');
      let contextMenuSplit = doc.getElementById('paneContext-afterMove');
      if ( !contextMenuSplit ) contextMenuSplit = doc.getElementById('mailContext-sep-print'); // SeaMonkey
      if ( status_bar ) { // add status bar icon
        this.createPopup(aWindow); // simple menu popup may can be in statusbarpanel by set that to 'statusbarpanel-menu-iconic', but better not
        let statusbarIcon = doc.createElementNS(XULNS, "statusbarpanel");
        statusbarIcon.id = statusbarIconID;
        statusbarIcon.setAttribute('class', 'statusbarpanel-iconic');
        statusbarIcon.setAttribute('src', statusbarIconSrc);
        statusbarIcon.setAttribute('tooltiptext', autoArchiveUtil.Name + " " + autoArchiveUtil.Version);
        statusbarIcon.setAttribute('popup', contextMenuID);
        statusbarIcon.setAttribute('context', contextMenuID);
        status_bar.insertBefore(statusbarIcon, null);
        aWindow._autoarchive.createdElements.push(statusbarIconID);
        let [preStatus, preDetail] = [autoArchiveService.STATUS_INIT, ""];
        aWindow._autoarchive.statusCallback = function(status, detail) {
          if ( status == autoArchiveService.STATUS_WAITIDLE ) statusbarIcon.setAttribute('src', statusbarIconSrcWait);
          else if ( status == autoArchiveService.STATUS_RUN ) statusbarIcon.setAttribute('src', statusbarIconSrcRun);
          else statusbarIcon.setAttribute('src', statusbarIconSrc);
          statusbarIcon.setAttribute('tooltiptext', autoArchiveUtil.Name + " " + autoArchiveUtil.Version + "\n" + ( preStatus == autoArchiveService.STATUS_FINISH ? preDetail + "\n": "" ) + detail);
          if ( autoArchivePref.options.update_statusbartext && aWindow.MsgStatusFeedback && ( status != autoArchiveService.STATUS_RUN || !Cc["@mozilla.org/activity-manager;1"] ) ) {
            // when STATUS_RUN, statusText will be set by autoArchiveActivity => mailWindow.js
            let statusText = autoArchiveUtil.Name + ": " + ( preStatus == autoArchiveService.STATUS_FINISH ? preDetail + ", ": "" ) + detail;
            aWindow._autoarchive.timer.initWithCallback( function() { // use timer to make sure I'm the last to setStatusString
              // can't use showStatusString as it will reset _defaultStatusText, but stopMeteors had a 0.5s delay
              let func = aWindow.MsgStatusFeedback.setStatusString || aWindow.MsgStatusFeedback.setJSDefaultStatus;
              if ( func ) func.call(aWindow.MsgStatusFeedback, statusText);
            }, 0, Ci.nsITimer.TYPE_ONE_SHOT );
          }
          [preStatus, preDetail] = [status, detail];
          let menu = doc.getElementById(contextMenuID);
          let label = autoArchive.strBundle.GetStringFromName("mainwindow.menu." + ( status == autoArchiveService.STATUS_RUN ? 'stop' : 'run' ));
          if ( menu && menu.firstChild ) menu.firstChild.setAttribute('label', label);
          if ( aWindow._autoarchive.prefCallback ) aWindow._autoarchive.prefCallback('hibernate'); // update menu for 1/4 hours etc
        };
        aWindow._autoarchive.prefCallback = function(key) {
          if ( key == 'hibernate' ) {
            let className = 'awsome_auto_archive-hibernate';
            let newValue = autoArchivePref.options[key];
            if ( newValue == 0 ) statusbarIcon.classList.remove(className);
            else statusbarIcon.classList.add(className);
            let scheduleMenu = doc.getElementById(contextMenuScheduleID);
            if ( scheduleMenu && scheduleMenu.firstChild && scheduleMenu.firstChild.childNodes  ) for ( let menuitem of scheduleMenu.firstChild.childNodes ) {
              if ( menuitem.tagName != 'menuitem' ) continue;
              let value = Number(menuitem.getAttribute('hibernate'));
              if ( value > 0 ) value += Date.now() / 1000;
              value = Math.round(value);
              let checked = ( ( value <= 0 && newValue == value ) || ( value > 0 && Math.abs(newValue - value) < 60 * 10 ) ); // Still checked within 10 minutes, this is for TB restart
              menuitem.setAttribute('checked', checked ? "true" : "false");
            };
          }
        };
        autoArchiveService.addStatusListener(aWindow._autoarchive.statusCallback);
        autoArchivePref.addPrefListener(aWindow._autoarchive.prefCallback);
        aWindow._autoarchive.prefCallback('hibernate');
      }
      if ( autoArchivePref.options.add_context_munu_rule && contextMenuSplit && contextMenuSplit.parentNode ) {
        let newMenu = doc.createElementNS(XULNS, "menuitem");
        newMenu.id = mailContextMenuID;
        newMenu.setAttribute('label', this.strBundle.GetStringFromName("mainwindow.menu.createRule"));
        newMenu.setAttribute('image', statusbarIconSrcWait);
        newMenu.addEventListener('command', this.createRuleBasedOn, false);
        contextMenuSplit.parentNode.addEventListener('popupshowing', this.beforePopupShow, true);
        newMenu.setAttribute('class', "menuitem-iconic");
        contextMenuSplit.parentNode.insertBefore(newMenu, contextMenuSplit);
        aWindow._autoarchive.contextMenuItem = newMenu;
        aWindow._autoarchive.createdElements.push(mailContextMenuID);
      }
      aWindow.addEventListener("unload", autoArchive.onUnLoad, false);
    }catch(err) {
      autoArchiveLog.logException(err);
    }
  },
  
  beforePopupShow: function(event) {
    let shouldShow = true;
    if ( !event.view || !event.view.document || !event.view._autoarchive || !event.view._autoarchive.contextMenuItem ) return true;
    else {
      let folderDisplay = event.view.gFolderDisplay;
      if ( !folderDisplay || folderDisplay.selectedCount <= 0 || folderDisplay.selectedMessages.length <= 0 ) shouldShow = false;
      else {
        // don't show if not a mail tab
        let tabmail = event.view.document.getElementById("tabmail");
        if ( tabmail && tabmail.selectedTab && tabmail.selectedTab.mode && event.view.mailTabType && !(tabmail.selectedTab.mode.name in event.view.mailTabType.modes) ) shouldShow = false;
      }
    }
    event.view._autoarchive.contextMenuItem.hidden = !shouldShow;
    return true;
  },
 
  onUnLoad: function(event) {
    let aWindow = event.currentTarget;
    autoArchiveLog.info('onUnLoad for ' + aWindow.location.href);
    if ( aWindow ) autoArchive.unLoad(aWindow);
  },

  unLoad: function(aWindow) {
    try {
      if ( typeof(aWindow._autoarchive) != 'undefined' ) {
        autoArchiveLog.info('unLoad for ' + aWindow.location.href);
        aWindow.removeEventListener("unload", autoArchive.onUnLoad, false);
        aWindow._autoarchive.timer.cancel();
        aWindow._autoarchive.hookedFunctions.forEach( function(hooked) {
          hooked.unweave();
        } );
        if ( aWindow._autoarchive.statusCallback ) autoArchiveService.removeStatusListener(aWindow._autoarchive.statusCallback);
        if ( aWindow._autoarchive.prefCallback ) autoArchivePref.removePrefListener(aWindow._autoarchive.prefCallback);
        if ( aWindow._autoarchive.contextMenuItem ) aWindow._autoarchive.contextMenuItem.parentNode.removeEventListener('popupshowing', this.beforePopupShow, true);
        let doc = aWindow.document;
        for ( let node of aWindow._autoarchive.createdElements ) {
          if ( typeof(node) == 'string' ) node = doc.getElementById(node);
          if ( node && node.parentNode ) {
            autoArchiveLog.info("removed node " + (node.id ? node.id : node));
            node.parentNode.removeChild(node);
          }
        }
        delete aWindow._autoarchive;
        autoArchiveLog.info('unLoad done for ' + aWindow.location.href);
      }
    } catch (err) {
      autoArchiveLog.logException(err);  
    }
  },

  cleanup: function() {
    try {
      autoArchiveLog.info('autoArchive cleanup');
      autoArchivePrefDialog.cleanup();
      autoArchiveActivity.cleanup();
      autoArchiveService.cleanup();
      autoArchivePref.cleanup();
      autoArchiveLog.cleanup();
    } catch (err) {
      autoArchiveLog.logException(err);  
    }
    autoArchiveLog.info('autoArchive cleanup done');
  },
  
  openOption: function(win, msgHdr) {
    win.openDialog("chrome://awsomeAutoArchive/content/autoArchivePrefDialog.xul", "_blank",
          ( Services.prefs.getBoolPref("browser.preferences.instantApply") ? '' : 'modal,' ) + 'chrome,titlebar,toolbar,centerscreen,resizable,dialog=yes', msgHdr);
  },
  
  addMenuItem: function(menu, doc, parent) {
    let isSubMenu = typeof(menu[2]) == 'object' && menu[2] instanceof Array;
    let item = doc.createElementNS(XULNS, menu[0] == '' ? "menuseparator" : isSubMenu ? 'menu' : "menuitem");
    if ( menu[0] != '' ) {
      item.setAttribute('label', menu[0]);
      if (menu[1]) item.setAttribute('image', menu[1]);
      if ( isSubMenu ) {
        let menupopup = doc.createElementNS(XULNS, "menupopup");
        menu[2].forEach( function(submenu) {
          autoArchive.addMenuItem(submenu, doc, menupopup);
        } );
        item.insertBefore(menupopup, null);
      } else if ( typeof(menu[2]) == 'function' ) item.addEventListener('command', menu[2], false);
      if ( menu[3] ) {
        for ( let attr in menu[3] ) {
          item.setAttribute(attr, menu[3][attr]);
        }
      }
      item.setAttribute('class', isSubMenu ? "menu-iconic" : "menuitem-iconic");
    }
    parent.insertBefore(item, null);
  },
  
  setHibernate: function(event) {
    let menuitem = event.currentTarget;
    let value = Number(menuitem.getAttribute('hibernate') || 0);
    if ( value > 0 ) value += Date.now() / 1000;
    let hibernate = Math.round(value);
    autoArchiveLog.info("setHibernate:" + hibernate + ":" + autoArchiveService._status[0]);
    autoArchivePref.setPerf('hibernate', hibernate);
    if ( autoArchiveService._status[0] != autoArchiveService.STATUS_RUN )
      autoArchiveService.preStart(autoArchivePref.options.startup_delay);
  },
  
  createPopup: function(aWindow) {
    let doc = aWindow.document;
    let popupset = doc.createElementNS(XULNS, "popupset");
    popupset.id = popupsetID;
    let menupopup = doc.createElementNS(XULNS, "menupopup");
    let menuGroupName = 'awsome_auto_archive-schedule';
    menupopup.id = contextMenuID;
    [ 
      ["?", autoArchivePref.path + "icon.png", function(){ autoArchiveService.starStopNow(); }], // run/stop must be the first menu item
      ["Option", "chrome://mozapps/skin/extensions/themeGeneric.png", function(){autoArchive.openOption(aWindow);}],
      ["Addon @ Mozilla", "chrome://mozapps/skin/extensions/extensionGeneric.png", function(){ autoArchiveUtil.loadUseProtocol("https://addons.mozilla.org/en-US/thunderbird/addon/awesome-auto-archive/"); }],
      ["Addon @ GitHub", "chrome://awsomeAutoArchive/content/github.png", function(){ autoArchiveUtil.loadUseProtocol("https://github.com/wangvisual/autoarchive/"); }],
      ["Help", "chrome://global/skin/icons/question-64.png", function(){ autoArchiveUtil.loadUseProtocol("https://github.com/wangvisual/autoarchive/wiki/Help"); }],
      ["Report Bug", "chrome://global/skin/icons/information-32.png", function(){ autoArchiveUtil.loadUseProtocol("https://github.com/wangvisual/autoarchive/issues"); }],
      [ "Schedule Control", 'chrome://awsomeAutoArchive/content/schedule.png', [
        ["Enable Archive", '', autoArchive.setHibernate, {hibernate: 0, name: menuGroupName, type: "radio"}],
        [""],
        ["Disable Archive for 1 hour", '',  autoArchive.setHibernate, {hibernate: 3600, name: menuGroupName, type: "radio"}],
        ["Disable Archive for 4 hours", '', autoArchive.setHibernate, {hibernate: 3600*4, name: menuGroupName, type: "radio"}],
        ["Disable Archive for 24 hours", '', autoArchive.setHibernate, {hibernate: 3600*24, name: menuGroupName, type: "radio"}],
        ["Disable Archive till " + Services.appinfo.name + " restart", '',  autoArchive.setHibernate, {hibernate: 0-Services.startup.getStartupInfo().main/1000, name: menuGroupName, type: "radio"}],
        ["Disable Archive forever", '', autoArchive.setHibernate, {hibernate: -1, name: menuGroupName, type: "radio"}],
      ], {id: contextMenuScheduleID} ],
      ["Donate", "chrome://awsomeAutoArchive/content/donate.png", function(){ autoArchiveUtil.loadDonate('mozilla'); }],
    ].forEach( function(menu) {
      autoArchive.addMenuItem(menu, doc, menupopup);
    } );
    popupset.insertBefore(menupopup, null);
    doc.documentElement.insertBefore(popupset, null);
    aWindow._autoarchive.createdElements.push(popupsetID);
  },
  createRuleBasedOn: function(event) {
    if ( !event.view ) return;
    let folderDisplay = event.view.gFolderDisplay;
    if ( !folderDisplay || folderDisplay.selectedCount <= 0 || folderDisplay.selectedMessages.length <= 0 ) return;
    let msgHdr = folderDisplay.selectedMessages[0];
    autoArchive.openOption(event.view, msgHdr);
  },
};
