/*!
 * VisualEditor MediaWiki Initialization DesktopArticleTarget class.
 *
 * @copyright 2011-2017 VisualEditor Team and others; see AUTHORS.txt
 * @license The MIT License (MIT); see LICENSE.txt
 */

/* global confirm, alert */

/**
 * MediaWiki desktop article target.
 *
 * @class
 * @extends ve.init.mw.ArticleTarget
 *
 * @constructor
 * @param {Object} config Configuration options
 */
ve.init.mw.DesktopArticleTarget = function VeInitMwDesktopArticleTarget( config ) {
	// A workaround, as default URI does not get updated after pushState (bug 72334)
	var currentUri = new mw.Uri( location.href );

	// Parent constructor
	ve.init.mw.DesktopArticleTarget.super.call(
		this, mw.config.get( 'wgRelevantPageName' ), currentUri.query.oldid, config
	);

	// Parent constructor bound key event handlers, but we don't want them bound until
	// we activate; so unbind them again
	this.unbindHandlers();

	this.onWatchToggleHandler = this.onWatchToggle.bind( this );

	// Properties
	this.onBeforeUnloadFallback = null;
	this.onUnloadHandler = this.onUnload.bind( this );
	this.activating = false;
	this.deactivating = false;
	this.edited = false;
	this.recreating = false;
	this.activatingDeferred = null;
	this.toolbarSetupDeferred = null;
	this.suppressNormalStartupDialogs = false;
	this.editingTabDialog = null;

	// If this is true then #transformPage / #restorePage will not call pushState
	// This is to avoid adding a new history entry for the url we just got from onpopstate
	// (which would mess up with the expected order of Back/Forwards browsing)
	this.actFromPopState = false;
	this.popState = {
		tag: 'visualeditor'
	};
	this.scrollTop = null;
	this.currentUri = currentUri;
	this.section = null;
	if ( $( '#wpSummary' ).length ) {
		this.initialEditSummary = $( '#wpSummary' ).val();
	} else {
		this.initialEditSummary = currentUri.query.summary;
	}
	this.namespaceName = mw.config.get( 'wgCanonicalNamespace' );
	this.viewUri = new mw.Uri( mw.util.getUrl( this.pageName ) );
	this.isViewPage = (
		mw.config.get( 'wgAction' ) === 'view' &&
		currentUri.query.diff === undefined
	);

	if ( $( '#wpTextbox1' ).length ) {
		// We're loading on top of the classic wikitext editor, so we don't
		// know the "proper" page title. But we can fake it with information
		// we have.
		this.originalDocumentTitle = ve.msg( 'pagetitle', mw.Title.newFromText( mw.config.get( 'wgPageName' ) ).getPrefixedText() );
	} else {
		this.originalDocumentTitle = document.title;
	}

	this.tabLayout = mw.config.get( 'wgVisualEditorConfig' ).tabLayout;
	this.events = new ve.init.mw.ArticleTargetEvents( this );
	this.$originalContent = $( '<div>' ).addClass( 've-init-mw-desktopArticleTarget-originalContent' );
	this.$editableContent = this.getEditableContent().addClass( 've-init-mw-desktopArticleTarget-editableContent' );

	// Initialization
	this.$element
		.addClass( 've-init-mw-desktopArticleTarget' )
		.append( this.$originalContent );

	if ( history.replaceState ) {
		// We replace the current state with one that's marked with our tag. This way, when users
		// use the Back button to exit the editor we can restore Read mode. This is because we want
		// to ignore foreign states in onWindowPopState. Without this, the Read state is foreign.
		// FIXME: There should be a much better solution than this.
		history.replaceState( this.popState, document.title, currentUri );
	}

	this.setupSkinTabs();

	window.addEventListener( 'popstate', this.onWindowPopState.bind( this ) );
};

/* Inheritance */

OO.inheritClass( ve.init.mw.DesktopArticleTarget, ve.init.mw.ArticleTarget );

/* Static Properties */

ve.init.mw.DesktopArticleTarget.static.actionGroups = [
	{ include: [ 'help', 'notices' ] },
	{
		type: 'list',
		icon: 'menu',
		title: ve.msg( 'visualeditor-pagemenu-tooltip' ),
		include: [ 'meta', 'settings', 'advancedSettings', 'categories', 'languages', 'findAndReplace' ]
	},
	{ include: [ 'editModeSource' ] }
];

/**
 * Compatibility map used with jQuery.client to black-list incompatible browsers.
 *
 * @static
 * @property
 */
ve.init.mw.DesktopArticleTarget.static.compatibility = {
	// The key is the browser name returned by jQuery.client
	// The value is either null (match all versions) or a list of tuples
	// containing an inequality (<,>,<=,>=) and a version number
	whitelist: {
		firefox: [ [ '>=', 12 ] ],
		iceweasel: [ [ '>=', 10 ] ],
		safari: [ [ '>=', 7 ] ],
		chrome: [ [ '>=', 19 ] ],
		msie: [ [ '>=', 10 ] ],
		edge: [ [ '>=', 12 ] ],
		opera: [ [ '>=', 15 ] ]
	}
};

ve.init.mw.DesktopArticleTarget.static.platformType = 'desktop';

/* Events */

/**
 * @event deactivate
 */

/**
 * @event transformPage
 */

/**
 * @event restorePage
 */

/**
 * @event saveWorkflowBegin
 * Fired when user clicks the button to open the save dialog.
 */

/**
 * @event saveWorkflowEnd
 * Fired when user exits the save workflow
 */

/**
 * @event saveReview
 * Fired when user initiates review changes in save workflow
 */

/**
 * @event saveInitiated
 * Fired when user initiates saving of the document
 */

/* Methods */

/**
 * Get the editable part of the page
 *
 * @return {jQuery} Editable DOM selection
 */
ve.init.mw.DesktopArticleTarget.prototype.getEditableContent = function () {
	var $editableContent, $content, $before,
		namespaceIds = mw.config.get( 'wgNamespaceIds' );

	if ( mw.config.get( 'wgAction' ) === 'view' ) {
		switch ( mw.config.get( 'wgNamespaceNumber' ) ) {
			case namespaceIds.category:
				// Put contents in a single wrapper
				// TODO: Fix upstream
				$content = $( '#mw-content-text > :not( .mw-category-generated )' );
				$editableContent = $( '<div>' ).prependTo( $( '#mw-content-text' ) ).append( $content );
				break;
			case namespaceIds.file:
				$editableContent = $( '#mw-imagepage-content' );
				if ( !$editableContent.length ) {
					// No image content, file doesn't exist, or is on Commons?
					$editableContent = $( '<div id="mw-imagepage-content">' );
					$before = $( '.sharedUploadNotice, #mw-imagepage-nofile' );
					if ( $before.length ) {
						$before.first().after( $editableContent );
					} else {
						// Nothing to anchor to, just prepend inside #mw-content-text
						$( '#mw-content-text' ).prepend( $editableContent );
					}
				}
				break;
			default:
				$editableContent = $( '#mw-content-text' );
		}
	} else {
		// TODO: Load view page content if switching from edit source
		$editableContent = $( '#mw-content-text' );
	}

	return $editableContent;
};

/**
 * Set the container for the target, appending the target to it
 *
 * @param {jQuery} $container Container
 */
ve.init.mw.DesktopArticleTarget.prototype.setContainer = function ( $container ) {
	$container.append( this.$element );
	this.$container = $container;
};

/**
 * Verify that a PopStateEvent correlates to a state we created.
 *
 * @param {Mixed} popState From PopStateEvent#state
 * @return {boolean}
 */
ve.init.mw.DesktopArticleTarget.prototype.verifyPopState = function ( popState ) {
	return popState && popState.tag === 'visualeditor';
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.setupToolbar = function ( surface ) {
	var toolbar, actionGroups,
		wasSetup = !!this.toolbar,
		target = this;

	ve.track( 'trace.setupToolbar.enter' );

	// Parent method
	ve.init.mw.DesktopArticleTarget.super.prototype.setupToolbar.call( this, surface );

	toolbar = this.getToolbar();

	ve.track( 'trace.setupToolbar.exit' );
	if ( !wasSetup ) {
		setTimeout( function () {
			toolbar.$element
				.css( 'height', toolbar.$bar.outerHeight() )
				.addClass( 've-init-mw-desktopArticleTarget-toolbar-open' );
			setTimeout( function () {
				// Clear to allow growth during use and when resizing window
				toolbar.$element
					.css( 'height', '' )
					.addClass( 've-init-mw-desktopArticleTarget-toolbar-opened' );
				target.toolbarSetupDeferred.resolve();
			}, 400 );
		} );

		this.toolbarSetupDeferred.done( function () {
			var surface = target.getSurface();
			// Check the surface wasn't torn down while the toolbar was animating
			if ( surface ) {
				ve.track( 'trace.initializeToolbar.enter' );
				target.getToolbar().initialize();
				surface.getView().emit( 'position' );
				surface.getContext().updateDimensions();
				ve.track( 'trace.initializeToolbar.exit' );
				ve.track( 'trace.activate.exit' );
			}
		} );
	}

	if ( surface.getMode() === 'source' ) {
		// HACK: Replace source button with VE button. This should be via the registry,
		// or we should have a toggle tool.
		actionGroups = ve.copy( this.constructor.static.actionGroups );
		actionGroups[ 2 ].include[ 0 ] = 'editModeVisual';
		this.getActions().setup( actionGroups, surface );
	}
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.attachToolbar = function () {
	// Move the toolbar to top of target, before heading etc.
	// Avoid re-attaching as it breaks CSS animations
	if ( !this.toolbar.$element.parent().is( this.$element ) ) {
		this.toolbar.$element
			// Set 0 before attach (expanded in #setupToolbar)
			.css( 'height', '0' )
			.addClass( 've-init-mw-desktopArticleTarget-toolbar' );
		this.$element.prepend( this.toolbar.$element );
	}
};

/**
 * Set up notices for things like unknown browsers.
 * Needs to be done on each activation because localNoticeMessages is cleared in clearState.
 */
ve.init.mw.DesktopArticleTarget.prototype.setupLocalNoticeMessages = function () {
	if ( mw.config.get( 'wgTranslatePageTranslation' ) === 'source' ) {
		// Warn users if they're on a source of the Page Translation feature
		this.localNoticeMessages.push( 'visualeditor-pagetranslationwarning' );
	}

	if ( !(
		'vewhitelist' in this.currentUri.query ||
		$.client.test( this.constructor.static.compatibility.whitelist, null, true )
	) ) {
		// Show warning in unknown browsers that pass the support test
		// Continue at own risk.
		this.localNoticeMessages.push( 'visualeditor-browserwarning' );
	}
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.loadSuccess = function () {
	var windowManager,
		target = this;

	// Parent method
	ve.init.mw.DesktopArticleTarget.super.prototype.loadSuccess.apply( this, arguments );

	this.wikitextFallbackLoading = false;
	// Duplicate of this code in ve.init.mw.DesktopArticleTarget.init.js
	if ( $( '#ca-edit' ).hasClass( 'visualeditor-showtabdialog' ) ) {
		$( '#ca-edit' ).removeClass( 'visualeditor-showtabdialog' );
		// Set up a temporary window manager
		windowManager = new OO.ui.WindowManager();
		$( 'body' ).append( windowManager.$element );
		this.editingTabDialog = new mw.libs.ve.EditingTabDialog();
		windowManager.addWindows( [ this.editingTabDialog ] );
		windowManager.openWindow( this.editingTabDialog )
			.then( function ( opened ) { return opened; } )
			.then( function ( closing ) { return closing; } )
			.then( function ( data ) {
				// Detach the temporary window manager
				windowManager.destroy();

				if ( data && data.action === 'prefer-wt' ) {
					target.switchToWikitextEditor( true, false );
				} else if ( data && data.action === 'multi-tab' ) {
					location.reload();
				}
			} );

		// Pretend the user saw the welcome dialog before suppressing it.
		if ( mw.user.isAnon() ) {
			try {
				localStorage.setItem( 've-beta-welcome-dialog', 1 );
			} catch ( e ) {
				$.cookie( 've-beta-welcome-dialog', 1, { path: '/', expires: 30 } );
			}
		} else {
			new mw.Api().saveOption( 'visualeditor-hidebetawelcome', '1' );
		}
		this.suppressNormalStartupDialogs = true;
	}
};

/**
 * Handle the watch button being toggled on/off.
 *
 * @param {jQuery.Event} e Event object which triggered the event
 * @param {string} actionPerformed 'watch' or 'unwatch'
 */
ve.init.mw.DesktopArticleTarget.prototype.onWatchToggle = function ( e, actionPerformed ) {
	if ( !this.active && !this.activating ) {
		return;
	}
	if ( this.checkboxesByName.wpWatchthis ) {
		this.checkboxesByName.wpWatchthis.setSelected(
			!!mw.user.options.get( 'watchdefault' ) ||
			( !!mw.user.options.get( 'watchcreations' ) && !this.pageExists ) ||
			actionPerformed === 'watch'
		);
	}
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.bindHandlers = function () {
	ve.init.mw.DesktopArticleTarget.super.prototype.bindHandlers.call( this );
	if ( this.onWatchToggleHandler ) {
		$( '#ca-watch, #ca-unwatch' ).on( 'watchpage.mw', this.onWatchToggleHandler );
	}
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.unbindHandlers = function () {
	ve.init.mw.DesktopArticleTarget.super.prototype.unbindHandlers.call( this );
	if ( this.onWatchToggleHandler ) {
		$( '#ca-watch, #ca-unwatch' ).off( 'watchpage.mw', this.onWatchToggleHandler );
	}
};

/**
 * Switch to edit mode.
 *
 * @param {jQuery.Promise} [dataPromise] Promise for pending request from
 *   mw.libs.ve.targetLoader#requestPageData, if any
 * @return {jQuery.Promise}
 */
ve.init.mw.DesktopArticleTarget.prototype.activate = function ( dataPromise ) {
	var surface,
		target = this;

	if ( !this.active && !this.activating ) {
		this.activating = true;
		this.activatingDeferred = $.Deferred();
		this.toolbarSetupDeferred = $.Deferred();

		$( 'html' ).addClass( 've-activating' );
		$.when( this.activatingDeferred, this.toolbarSetupDeferred ).done( function () {
			target.afterActivate();
		} ).fail( function () {
			$( 'html' ).removeClass( 've-activating' );
		} );

		this.bindHandlers();

		this.originalEditondbclick = mw.user.options.get( 'editondblclick' );
		mw.user.options.set( 'editondblclick', 0 );

		// Save the scroll position; will be restored by surfaceReady()
		this.saveScrollPosition();

		// User interface changes
		this.transformPage();
		this.setupLocalNoticeMessages();

		// Create dummy surface to show toolbar while loading
		surface = this.addSurface( new ve.dm.Document( [
			{ type: 'paragraph' }, { type: '/paragraph' },
			{ type: 'internalList' }, { type: '/internalList' }
		] ) );
		surface.setDisabled( true );
		// setSurface creates dummy toolbar
		this.dummyToolbar = true;
		this.setSurface( surface );
		// Disconnect the tool factory listeners so the toolbar
		// doesn't start showing new tools as they load, too
		// much flickering
		this.getToolbar().getToolFactory().off( 'register' );
		// Disable all the tools
		this.getToolbar().updateToolState();

		this.load( dataPromise );
	}
	return this.activatingDeferred.promise();
};

/**
 * Edit mode has finished activating
 */
ve.init.mw.DesktopArticleTarget.prototype.afterActivate = function () {
	$( 'html' ).removeClass( 've-activating' ).addClass( 've-active' );
	if ( !this.editingTabDialog ) {
		if ( this.sectionTitle ) {
			this.sectionTitle.focus();
		} else {
			// We have to focus the page after hiding the original content, otherwise
			// in firefox the contentEditable container was below the view page, and
			// 'focus' scrolled the screen down.
			// Support: Firefox
			this.getSurface().getView().focus();
		}
	}
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.setSurface = function ( surface ) {
	if ( surface !== this.surface ) {
		this.setupNewSection( surface );
		this.$editableContent.after( surface.$element );
	}

	// Parent method
	ve.init.mw.DesktopArticleTarget.super.prototype.setSurface.apply( this, arguments );
};

/**
 * Setup new section inputs if required
 *
 * @param {ve.ui.Surface} surface Surface
 */
ve.init.mw.DesktopArticleTarget.prototype.setupNewSection = function ( surface ) {
	if ( surface.getMode() === 'source' && this.section === 'new' ) {
		if ( !this.sectionTitle ) {
			this.sectionTitle = new OO.ui.TextInputWidget( {
				classes: [ 've-ui-init-desktopArticleTarget-sectionTitle' ],
				maxLength: 255,
				placeholder: ve.msg( 'visualeditor-section-title-placeholder' )
			} );
			this.sectionTitle.connect( this, { change: 'updateToolbarSaveButtonState' } );
		}
		surface.setPlaceholder( ve.msg( 'visualeditor-section-body-placeholder' ) );
		this.$editableContent.before( this.sectionTitle.$element );
	}
};

/**
 * Teardown new section inputs
 */
ve.init.mw.DesktopArticleTarget.prototype.teardownNewSection = function () {
	if ( this.getSurface() ) {
		this.getSurface().setPlaceholder( '' );
	}
	if ( this.sectionTitle ) {
		this.sectionTitle.$element.remove();
		this.sectionTitle = null;
	}
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.clearSurfaces = function () {
	this.teardownNewSection();

	// Parent method
	ve.init.mw.DesktopArticleTarget.super.prototype.clearSurfaces.apply( this, arguments );
};

/**
 * Determines whether we want to switch to view mode or not (displaying a dialog if necessary)
 * Then, if we do, actually switches to view mode.
 *
 * A dialog will not be shown if deactivate() is called while activation is still in progress,
 * or if the noDialog parameter is set to true. If deactivate() is called while the target
 * is deactivating, or while it's not active and not activating, nothing happens.
 *
 * @param {boolean} [noDialog] Do not display a dialog
 * @param {string} [trackMechanism] Abort mechanism; used for event tracking if present
 */
ve.init.mw.DesktopArticleTarget.prototype.deactivate = function ( noDialog, trackMechanism ) {
	var target = this;
	if ( this.deactivating || ( !this.active && !this.activating ) ) {
		return;
	}

	// Just in case these weren't closed before
	if ( this.welcomeDialog ) {
		this.welcomeDialog.close();
	}
	if ( this.editingTabDialog ) {
		this.editingTabDialog.close();
	}
	this.teardownNewSection();
	this.editingTabDialog = null;

	if ( noDialog || this.activating || !this.edited ) {
		this.emit( 'deactivate' );
		this.cancel( trackMechanism );
	} else {
		this.getSurface().dialogs.openWindow( 'cancelconfirm' ).then( function ( opened ) {
			opened.then( function ( closing ) {
				closing.then( function ( data ) {
					if ( data && data.action === 'discard' ) {
						target.emit( 'deactivate' );
						target.cancel( trackMechanism );
					}
				} );
			} );
		} );
	}
};

/**
 * Switch to view mode
 *
 * @param {string} [trackMechanism] Abort mechanism; used for event tracking if present
 */
ve.init.mw.DesktopArticleTarget.prototype.cancel = function ( trackMechanism ) {
	var abortType,
		target = this,
		promises = [];

	// Event tracking
	if ( trackMechanism ) {
		if ( this.activating ) {
			abortType = 'preinit';
		} else if ( !this.edited ) {
			abortType = 'nochange';
		} else if ( this.saving ) {
			abortType = 'abandonMidsave';
		} else {
			// switchwith and switchwithout do not go through this code path,
			// they go through switchToWikitextEditor() instead
			abortType = 'abandon';
		}
		ve.track( 'mwedit.abort', {
			type: abortType,
			mechanism: trackMechanism
		} );
	}

	// Cancel activating, start deactivating
	this.deactivating = true;
	this.activating = false;
	this.activatingDeferred.reject();
	$( 'html' ).addClass( 've-deactivating' ).removeClass( 've-activated ve-active' );

	// User interface changes
	if ( this.elementsThatHadOurAccessKey ) {
		this.elementsThatHadOurAccessKey.attr( 'accesskey', ve.msg( 'accesskey-save' ) );
	}
	this.restorePage();

	this.unbindHandlers();

	mw.user.options.set( 'editondblclick', this.originalEditondbclick );
	this.originalEditondbclick = undefined;

	if ( this.toolbarSaveButton ) {
		this.toolbarSaveButton = null;
	}

	// Check we got as far as setting up the surface
	if ( this.getSurface() ) {
		if ( this.active ) {
			this.teardownUnloadHandlers();
		}
		promises.push( this.teardownSurface() );
	} else if ( this.toolbar ) {
		// If a dummy toolbar was created, destroy it
		this.toolbar.destroy();
	}

	$.when.apply( null, promises ).done( function () {
		// If there is a load in progress, abort it
		if ( target.loading ) {
			target.loading.abort();
		}

		target.clearState();
		target.initialEditSummary = new mw.Uri().query.summary;

		target.deactivating = false;
		$( 'html' ).removeClass( 've-deactivating' );

		// Move original content back out of the target
		target.$element.parent().append( target.$originalContent.children() );
		$( '.ve-init-mw-desktopArticleTarget-uneditableContent' )
			.off( '.ve-target' )
			.removeClass( 've-init-mw-desktopArticleTarget-uneditableContent' );

		mw.hook( 've.deactivationComplete' ).fire( target.edited );
	} );
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.loadFail = function ( error, errorText ) {
	var errorInfo, confirmPromptMessage,
		target = this;

	this.activatingDeferred.reject();

	// Parent method
	ve.init.mw.DesktopArticleTarget.super.prototype.loadFail.apply( this, arguments );

	if ( this.wikitextFallbackLoading ) {
		// Failed twice now
		mw.log.warn( 'Failed to fall back to wikitext', errorText, error );
		location.href = target.viewUri.clone().extend( { action: 'edit', veswitched: 1 } );
		return;
	}

	// Don't show an error if the load was manually aborted
	// The response.status check here is to catch aborts triggered by navigation away from the page
	if (
		error &&
		Object.prototype.hasOwnProperty.call( error, 'error' ) &&
		Object.prototype.hasOwnProperty.call( error.error, 'info' )
	) {
		errorInfo = error.error.info;
	}

	if ( !error || error.statusText !== 'abort' ) {
		if ( errorText === 'http' || errorText === 'error' ) {
			if ( error && ( error.status || ( error.xhr && error.xhr.status ) ) ) {
				confirmPromptMessage = ve.msg(
					'visualeditor-loadwarning',
					'HTTP ' + ( error.status || error.xhr.status )
				);
			} else {
				confirmPromptMessage = ve.msg(
					'visualeditor-loadwarning',
					ve.msg( 'visualeditor-loadwarning-noconnect' )
				);
			}
		} else if ( errorInfo ) {
			confirmPromptMessage = ve.msg( 'visualeditor-loadwarning', errorText + ': ' + errorInfo );
		} else {
			// At least give the devs something to work from
			confirmPromptMessage = JSON.stringify( error );
		}
	}

	if ( confirmPromptMessage ) {
		OO.ui.confirm( confirmPromptMessage ).done( function ( confirmed ) {
			if ( confirmed ) {
				target.load();
			} else if ( $( '#wpTextbox1' ).length && !ve.init.target.isModeAvailable( 'source' ) ) {
				// If we're switching from the wikitext editor, just deactivate
				// don't try to switch back to it fully, that'd discard changes.
				target.deactivate( true );
			} else {
				// TODO: Some sort of progress bar?
				target.wikitextFallbackLoading = true;
				target.switchToWikitextEditor( true, false );
			}
		} );
	} else {
		if ( error.statusText !== 'abort' ) {
			mw.log.warn( 'Failed to find error message', errorText, error );
		}
		this.deactivate( true );
	}
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.surfaceReady = function () {
	var surface = this.getSurface(),
		surfaceReadyTime = ve.now(),
		target = this;

	if ( !this.activating ) {
		// Activation was aborted before we got here. Do nothing
		// TODO are there things we need to clean up?
		return;
	}

	this.activating = false;

	// TODO: mwTocWidget should probably live in a ve.ui.MWSurface subclass
	if ( mw.config.get( 'wgVisualEditorConfig' ).enableTocWidget ) {
		surface.mwTocWidget = new ve.ui.MWTocWidget( this.getSurface() );
		surface.$element.before( surface.mwTocWidget.$element );
	}

	// Track how long it takes for the first transaction to happen
	surface.getModel().getDocument().once( 'transact', function () {
		ve.track( 'mwtiming.behavior.firstTransaction', {
			duration: ve.now() - surfaceReadyTime,
			targetName: target.constructor.static.trackingName
		} );
	} );

	surface.getModel().getMetaList().connect( this, {
		insert: 'onMetaItemInserted',
		remove: 'onMetaItemRemoved'
	} );

	// Update UI
	this.changeDocumentTitle();
	// Support: IE<=11
	// IE requires us to defer before restoring the scroll position
	setTimeout( function () {
		target.restoreScrollPosition();
	} );

	// Parent method
	ve.init.mw.DesktopArticleTarget.super.prototype.surfaceReady.apply( this, arguments );

	this.setupUnloadHandlers();
	if ( !this.suppressNormalStartupDialogs ) {
		this.maybeShowWelcomeDialog();
		this.maybeShowMetaDialog();
	}

	this.activatingDeferred.resolve();
	this.events.trackActivationComplete();

	mw.hook( 've.activationComplete' ).fire();
};

/**
 * Add the redirect header when a redirect is inserted into the page.
 *
 * @param {ve.dm.MetaItem} metaItem Item that was inserted
 * @param {boolean} [loading=false] Whether VE is loading.
 */
ve.init.mw.DesktopArticleTarget.prototype.onMetaItemInserted = function ( metaItem, loading ) {
	var title, target, $link,
		metaList = this.surface.getModel().getMetaList();
	switch ( metaItem.getType() ) {
		case 'mwRedirect':
			target = this;
			title = metaItem.getAttribute( 'title' );
			$link = $( '<a>' )
				.attr( 'title', mw.msg( 'visualeditor-redirect-description', title ) )
				.text( title );
			ve.init.platform.linkCache.styleElement( title, $link );

			if ( loading ) {
				this.$originalRedirectMsg = $( '.redirectMsg' ).clone();
				this.$originalRedirectSub = $( '#redirectsub, #redirectsub + br' ).clone();
			}
			// Add redirect target header
			if ( !$( '#redirectsub' ).length ) {
				$( '#contentSub' ).append(
					$( '<span>' )
						.text( mw.msg( 'redirectpagesub' ) )
						.attr( 'id', 'redirectsub' ),
					$( '<br>' )
				);
			}
			$( '<div>' )
				// Bit of a hack: Make sure any redirect note is styled
				.addClass( 'redirectMsg mw-content-' + $( 'html' ).attr( 'dir' ) )

				.addClass( 've-redirect-header' )
				.append(
					$( '<p>' ).text( mw.msg( 'redirectto' ) ),
					$( '<ul>' )
						.addClass( 'redirectText' )
						.append( $( '<li>' ).append( $link ) )
				)
				.click( function ( e ) {
					var windowAction = ve.ui.actionFactory.create( 'window', target.getSurface() );
					windowAction.open( 'meta', { page: 'settings' } );
					e.preventDefault();
				} )
				.insertAfter( $( '.mw-jump' ) );
			break;
		case 'mwCategory':
			this.rebuildCategories( metaList.getItemsInGroup( 'mwCategory' ) );
			break;
	}
};

/**
 * Remove the redirect header when a redirect is removed from the page.
 *
 * @param {ve.dm.MetaItem} metaItem Item that was removed
 * @param {number} offset Linear model offset that the item was at
 * @param {number} index Index within that offset the item was at
 */
ve.init.mw.DesktopArticleTarget.prototype.onMetaItemRemoved = function ( metaItem ) {
	var metaList = this.surface.getModel().getMetaList();
	switch ( metaItem.getType() ) {
		case 'mwRedirect':
			this.$originalContent.find( '.redirectMsg' ).remove();
			$( '#contentSub #redirectsub, #contentSub #redirectsub + br' ).remove();
			break;
		case 'mwCategory':
			this.rebuildCategories( metaList.getItemsInGroup( 'mwCategory' ) );
			break;
	}
};

/**
 * Redisplay the category list on the page
 *
 * @param {ve.dm.MetaItem[]} categoryItems Array of category metaitems to display
 */
ve.init.mw.DesktopArticleTarget.prototype.rebuildCategories = function ( categoryItems ) {
	var target = this;
	// We need to fetch this from the API because the category list is skin-
	// dependent, so the HTML output could be absolutely anything.
	new mw.Api().post( {
		formatversion: 2,
		action: 'parse',
		contentmodel: 'wikitext',
		text: categoryItems.map( function ( categoryItem ) {
			// TODO: wikitext-building is a bad smell here, but is done
			// because there's no other API call that will get the category
			// markup. Adding such an API, if other use cases for it emerge,
			// might make sense.
			if ( categoryItem.getAttribute( 'sortkey' ) ) {
				return '[[' + categoryItem.getAttribute( 'category' ) + '|' + categoryItem.getAttribute( 'sortkey' ) + ']]';
			}
			return '[[' + categoryItem.getAttribute( 'category' ) + ']]';
		} ).join( '\n' ),
		prop: 'categorieshtml'
	} ).then( function ( response ) {
		var $categories;
		if ( !response || !response.parse || !response.parse.categorieshtml ) {
			return;
		}
		$categories = $( $.parseHTML( response.parse.categorieshtml ) );
		target.transformCategoryLinks( $categories );
		target.disableUneditableContent( $categories );
		mw.hook( 'wikipage.categories' ).fire( $categories );
		$( '#catlinks' ).replaceWith( $categories );
	} );
};

/**
 * Handle Escape key presses.
 *
 * @param {jQuery.Event} e Keydown event
 */
ve.init.mw.DesktopArticleTarget.prototype.onDocumentKeyDown = function ( e ) {
	var target = this;

	// Parent method
	ve.init.mw.DesktopArticleTarget.super.prototype.onDocumentKeyDown.apply( this, arguments );

	if ( e.which === OO.ui.Keys.ESCAPE ) {
		setTimeout( function () {
			// Listeners should stopPropagation if they handle the escape key, but
			// also check they didn't fire after this event, as would be the case if
			// they were bound to the document.
			if ( !e.isPropagationStopped() ) {
				target.deactivate( false, 'navigate-read' );
			}
		} );
		e.preventDefault();
	}
};

/**
 * Handle clicks on the view tab.
 *
 * @method
 * @param {jQuery.Event} e Mouse click event
 */
ve.init.mw.DesktopArticleTarget.prototype.onViewTabClick = function ( e ) {
	if ( !ve.isUnmodifiedLeftClick( e ) ) {
		return;
	}
	this.deactivate( false, 'navigate-read' );
	e.preventDefault();
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.saveComplete = function (
	html, categoriesHtml, newid, isRedirect, displayTitle, lastModified, contentSub, modules, jsconfigvars
) {
	var newUrlParams, watchChecked;

	// Parent method
	ve.init.mw.DesktopArticleTarget.super.prototype.saveComplete.apply( this, arguments );

	if ( !this.pageExists || this.restoring ) {
		// This is a page creation or restoration, refresh the page
		this.teardownUnloadHandlers();
		newUrlParams = newid === undefined ? {} : { venotify: this.restoring ? 'restored' : 'created' };

		if ( isRedirect ) {
			newUrlParams.redirect = 'no';
		}
		location.href = this.viewUri.extend( newUrlParams );
	} else {
		// Update watch link to match 'watch checkbox' in save dialog.
		// User logged in if module loaded.
		// Just checking for mw.page.watch is not enough because in Firefox
		// there is Object.prototype.watch...
		if ( mw.page.hasOwnProperty( 'watch' ) ) {
			watchChecked = this.checkboxesByName.wpWatchthis && this.checkboxesByName.wpWatchthis.isSelected();
			mw.page.watch.updateWatchLink(
				$( '#ca-watch a, #ca-unwatch a' ),
				watchChecked ? 'unwatch' : 'watch'
			);
		}

		// If we were explicitly editing an older version, make sure we won't
		// load the same old version again, now that we've saved the next edit
		// will be against the latest version.
		// If there is an ?oldid= parameter in the URL, this will cause restorePage() to remove it.
		this.restoring = false;

		// Clear requestedRevId in case it was set by a retry or something; after saving
		// we don't want to go back into oldid mode anyway
		this.requestedRevId = undefined;

		if ( newid !== undefined ) {
			mw.config.set( {
				wgCurRevisionId: newid,
				wgRevisionId: newid
			} );
			this.revid = newid;
			this.currentRevisionId = newid;
		}

		// Update module JS config values and notify ResourceLoader of any new
		// modules needed to be added to the page
		mw.config.set( jsconfigvars );
		mw.loader.load( modules );

		this.saveDialog.reset();
		this.replacePageContent(
			html,
			categoriesHtml,
			displayTitle,
			lastModified,
			contentSub,
			!!isRedirect
		);

		if ( newid !== undefined ) {
			$( '#t-permalink a, #coll-download-as-rl a' ).each( function () {
				var uri = new mw.Uri( $( this ).attr( 'href' ) );
				uri.query.oldid = newid;
				$( this ).attr( 'href', uri.toString() );
			} );
		}

		// Tear down the target now that we're done saving
		// Not passing trackMechanism because this isn't an abort action
		this.deactivate( true );
		if ( newid !== undefined ) {
			mw.hook( 'postEdit' ).fire( {
				message: ve.msg( 'postedit-confirmation-saved', mw.user )
			} );
		}
	}
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.serializeFail = function ( jqXHR, status ) {
	// Parent method
	ve.init.mw.DesktopArticleTarget.super.prototype.serializeFail.apply( this, arguments );

	OO.ui.alert( ve.msg( 'visualeditor-serializeerror', status ) );

	this.getSurface().getDialogs().closeWindow( 'wikitextswitchconfirm' );
	this.resetDocumentOpacity();

	// It's possible to get here while the save dialog has never been opened (if the user uses
	// the switch to source mode option)
	if ( this.saveDialog ) {
		this.saveDialog.popPending();
	}
};

/**
 * Handle clicks on the MwMeta button in the toolbar.
 *
 * @method
 * @param {jQuery.Event} e Mouse click event
 */
ve.init.mw.DesktopArticleTarget.prototype.onToolbarMetaButtonClick = function () {
	this.getSurface().getDialogs().openWindow( 'meta' );
};

/**
 * Open the dialog to switch to edit source mode with the current wikitext, or just do it straight
 * away if the document is unmodified. If we open the dialog, the document opacity will be set to
 * half, which can be reset with the resetDocumentOpacity function.
 *
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.editSource = function () {
	var modified = this.fromEditedState || this.getSurface().getModel().hasBeenModified();

	if ( ve.init.target.isModeAvailable( 'source' ) ) {
		this.switchToWikitextEditor( false, modified );
	} else if ( !modified ) {
		this.switchToWikitextEditor( true, modified );
	} else {
		this.getSurface().getView().getDocument().getDocumentNode().$element.css( 'opacity', 0.5 );

		ve.ui.actionFactory.create( 'window', this.getSurface() )
			.open( 'wikitextswitchconfirm', { target: this } );
	}
};

/**
 * Switch to viewing mode.
 *
 * @return {jQuery.Promise} Promise resolved when surface is torn down
 */
ve.init.mw.DesktopArticleTarget.prototype.teardownSurface = function () {
	var target = this,
		promises = [];

	// Update UI
	promises.push( this.teardownToolbar() );
	this.restoreDocumentTitle();

	if ( this.saveDialog ) {
		if ( this.saveDialog.isOpened() ) {
			// If the save dialog is still open (from saving) close it
			promises.push( this.saveDialog.close() );
		}
		// Release the reference
		this.saveDialog = null;
	}

	return $.when.apply( null, promises ).then( function () {
		var surface;
		// Destroy surface
		while ( target.surfaces.length ) {
			surface = target.surfaces.pop();
			surface.destroy();
			if ( surface.mwTocWidget ) {
				surface.mwTocWidget.$element.remove();
			}
		}
		target.active = false;
	} );
};

/**
 * Modify tabs in the skin to support in-place editing.
 *
 * 'Read' and 'Edit source' (when not using single edit tab) bound here,
 * 'Edit' and single edit tab are bound in mw.DesktopArticleTarget.init.
 *
 * @method
 */
ve.init.mw.DesktopArticleTarget.prototype.setupSkinTabs = function () {
	var target = this;
	if ( this.isViewPage ) {
		// Allow instant switching back to view mode, without refresh
		$( '#ca-view a, #ca-nstab-visualeditor a' )
			.on( 'click', this.onViewTabClick.bind( this ) );

	}
	if ( !mw.libs.ve.isSingleEditTab ) {
		$( '#ca-viewsource, #ca-edit' ).on( 'click', function ( e ) {
			if ( !target.active || !ve.isUnmodifiedLeftClick( e ) ) {
				return;
			}

			if ( target.getSurface() && !target.deactivating && target.getDefaultMode() !== 'source' ) {
				target.editSource();

				if ( target.getSurface().getModel().hasBeenModified() || target.fromEditedState ) {
					e.preventDefault();
				}
			}
		} );
	}

	mw.hook( 've.skinTabSetupComplete' ).fire();
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.attachToolbarSaveButton = function () {
	this.toolbar.$actions.append( this.toolbarSaveButton.$element );
};

/**
 * @inheritdoc
 */
ve.init.mw.DesktopArticleTarget.prototype.getSaveDialogOpeningData = function () {
	var data = ve.init.mw.DesktopArticleTarget.super.prototype.getSaveDialogOpeningData.apply( this, arguments );
	data.editSummary = this.initialEditSummary;
	return data;
};

/**
 * Remember the window's scroll position.
 */
ve.init.mw.DesktopArticleTarget.prototype.saveScrollPosition = function () {
	if ( this.getDefaultMode() === 'source' && this.section !== null ) {
		// Reset scroll to top if doing real section editing
		this.scrollTop = 0;
	} else {
		this.scrollTop = $( window ).scrollTop();
	}
};

/**
 * Restore the window's scroll position.
 */
ve.init.mw.DesktopArticleTarget.prototype.restoreScrollPosition = function () {
	if ( this.scrollTop !== null ) {
		$( window ).scrollTop( this.scrollTop );
		this.scrollTop = null;
	}
};

/**
 * Hide the toolbar.
 *
 * @return {jQuery.Promise} Promise which resolves when toolbar is hidden
 */
ve.init.mw.DesktopArticleTarget.prototype.teardownToolbar = function () {
	var target = this,
		deferred = $.Deferred();
	this.toolbar.$element.css( 'height', this.toolbar.$bar.outerHeight() );
	setTimeout( function () {
		target.toolbar.$element
			.css( 'height', '0' )
			.removeClass( 've-init-mw-desktopArticleTarget-toolbar-open' )
			.removeClass( 've-init-mw-desktopArticleTarget-toolbar-opened' );
		setTimeout( function () {
			// Parent method
			ve.init.mw.DesktopArticleTarget.super.prototype.teardownToolbar.call( target );
			deferred.resolve();
		}, 400 );
	} );
	return deferred.promise();
};

/**
 * Change the document title to state that we are now editing.
 */
ve.init.mw.DesktopArticleTarget.prototype.changeDocumentTitle = function () {
	var pageName = mw.config.get( 'wgPageName' ),
		title = mw.Title.newFromText( pageName );
	if ( title ) {
		pageName = title.getPrefixedText();
	}
	document.title = ve.msg(
		this.pageExists ? 'editing' : 'creating',
		pageName
	) + ' - ' + mw.config.get( 'wgSiteName' );
};

/**
 * Restore the original document title.
 */
ve.init.mw.DesktopArticleTarget.prototype.restoreDocumentTitle = function () {
	document.title = this.originalDocumentTitle;
};

/**
 * Page modifications for switching to edit mode.
 */
ve.init.mw.DesktopArticleTarget.prototype.transformPage = function () {
	var $content;

	this.updateTabs( true );
	this.emit( 'transformPage' );

	mw.hook( 've.activate' ).fire();

	// Move all native content inside the target
	this.$originalContent.append( this.$element.siblings() );
	this.$originalCategories = $( '#catlinks' ).clone( true );

	// Mark every non-direct ancestor between editableContent and the container as uneditable
	$content = this.$editableContent;
	while ( $content && !$content.parent().is( this.$container ) ) {
		$content.prevAll().addClass( 've-init-mw-desktopArticleTarget-uneditableContent' );
		$content.nextAll().addClass( 've-init-mw-desktopArticleTarget-uneditableContent' );
		$content = $content.parent();
	}

	this.transformCategoryLinks( $( '.catlinks' ) );

	this.disableUneditableContent();

	this.updateHistoryState();
};

/**
 * Category link section transformations for switching to edit mode. Broken out
 * so it can be re-applied when displaying changes to the categories.
 *
 * @param {jQuery} $catlinks Category links container element
 */
ve.init.mw.DesktopArticleTarget.prototype.transformCategoryLinks = function ( $catlinks ) {
	var target = this;
	// Un-disable the catlinks wrapper, but not the links
	$catlinks.removeClass( 've-init-mw-desktopArticleTarget-uneditableContent' )
		.on( 'click.ve-target', function () {
			var windowAction = ve.ui.actionFactory.create( 'window', target.getSurface() );
			windowAction.open( 'meta', { page: 'categories' } );
			return false;
		} )
		.find( 'a' ).addClass( 've-init-mw-desktopArticleTarget-uneditableContent' );
};

/**
 * Disabling of non-editable content, in a given context
 *
 * @param {jQuery|string} [context] Context to disable in
 */
ve.init.mw.DesktopArticleTarget.prototype.disableUneditableContent = function ( context ) {
	$( '.ve-init-mw-desktopArticleTarget-uneditableContent', context ).on( 'click.ve-target', function ( e ) {
		// Support IE9: Prevent default, but don't stop propagation
		e.preventDefault();
	} );
};

/**
 * Update the history state based on the editor mode
 */
ve.init.mw.DesktopArticleTarget.prototype.updateHistoryState = function () {
	var uri,
		veaction = this.getDefaultMode() === 'visual' ? 'edit' : 'editsource';

	// Push veaction=edit(source) url in history (if not already. If we got here by a veaction=edit(source)
	// permalink then it will be there already and the constructor called #activate)
	if (
		!this.actFromPopState &&
		history.pushState &&
		(
			this.currentUri.query.veaction !== veaction ||
			this.currentUri.query.section !== this.section
		) &&
		this.currentUri.query.action !== 'edit'
	) {
		// Set the current URL
		uri = this.currentUri;

		if ( mw.libs.ve.isSingleEditTab ) {
			uri.query.action = 'edit';
			mw.config.set( 'wgAction', 'edit' );
		} else {
			uri.query.veaction = veaction;
			delete uri.query.action;
			mw.config.set( 'wgAction', 'view' );
		}
		if ( this.section !== null ) {
			uri.query.section = this.section;
		} else {
			delete uri.query.section;
		}

		history.pushState( this.popState, document.title, uri );
	}
	this.actFromPopState = false;
};

/**
 * Page modifications for switching back to view mode.
 */
ve.init.mw.DesktopArticleTarget.prototype.restorePage = function () {
	var uri, keys;

	// Skins like monobook don't have a tab for view mode and instead just have the namespace tab
	// selected. We didn't deselect the namespace tab, so we're ready after deselecting #ca-ve-edit.
	// In skins having #ca-view (like Vector), select that.
	this.updateTabs( false );

	// Remove any VE-added redirectMsg
	if ( $( '.mw-body-content > .ve-redirect-header' ).length ) {
		$( '.mw-body-content > .ve-redirect-header' ).remove();
		$( '#contentSub #redirectSub, #contentSub #redirectSub + br' ).remove();
	}

	// Restore any previous redirectMsg/redirectsub
	if ( this.$originalRedirectMsg ) {
		this.$originalRedirectMsg.prependTo( $( '#mw-content-text' ) );
		this.$originalRedirectSub.prependTo( $( '#contentSub' ) );
		this.$originalRedirectMsg = undefined;
		this.$originalRedirectSub = undefined;
	}
	if ( this.$originalCategories ) {
		$( '#catlinks' ).replaceWith( this.$originalCategories );
	}

	mw.hook( 've.deactivate' ).fire();
	this.emit( 'restorePage' );

	// Push article url into history
	if ( !this.actFromPopState && history.pushState ) {
		// Remove the VisualEditor query parameters
		uri = this.currentUri;
		if ( 'veaction' in uri.query ) {
			delete uri.query.veaction;
		}
		if ( 'section' in uri.query ) {
			delete uri.query.section;
		}
		if ( 'action' in uri.query && $( '#wpTextbox1' ).length === 0 ) {
			delete uri.query.action;
			mw.config.set( 'wgAction', 'view' );
		}
		if ( 'oldid' in uri.query && !this.restoring ) {
			// We have an oldid in the query string but it's the most recent one, so remove it
			delete uri.query.oldid;
		}

		// If there are any other query parameters left, re-use that uri object.
		// Otherwise use the canonical style view url (T44553, T102363).
		keys = Object.keys( uri.query );
		if ( !keys.length || ( keys.length === 1 && keys[ 0 ] === 'title' ) ) {
			history.pushState( this.popState, document.title, this.viewUri );
		} else {
			history.pushState( this.popState, document.title, uri );
		}
	}
};

/**
 * @param {Event} e Native event object
 */
ve.init.mw.DesktopArticleTarget.prototype.onWindowPopState = function ( e ) {
	var veaction;

	if ( !this.verifyPopState( e.state ) ) {
		// Ignore popstate events fired for states not created by us
		// This also filters out the initial fire in Chrome (bug 57901).
		return;
	}

	this.currentUri = new mw.Uri( location.href );
	veaction = this.currentUri.query.veaction;

	if ( ve.init.target.isModeAvailable( 'source' ) && this.active ) {
		if ( veaction === 'editsource' && this.getDefaultMode() === 'visual' ) {
			this.actFromPopState = true;
			this.switchToWikitextEditor();
		} else if ( veaction === 'edit' && this.getDefaultMode() === 'source' ) {
			this.actFromPopState = true;
			this.switchToVisualEditor();
		}
	}
	if ( !this.active && ( veaction === 'edit' || veaction === 'editsource' ) ) {
		this.actFromPopState = true;
		this.activate();
	}
	if ( this.active && veaction !== 'edit' && veaction !== 'editsource' ) {
		this.actFromPopState = true;
		this.deactivate( false, 'navigate-back' );
	}
};

/**
 * Replace the page content with new HTML.
 *
 * @method
 * @param {string} html Rendered HTML from server
 * @param {string} categoriesHtml Rendered categories HTML from server
 * @param {string} displayTitle HTML to show as the page title
 * @param {Object} lastModified Object containing user-formatted date
 *  and time strings, or undefined if we made no change.
 * @param {string} contentSub HTML to show as the content subtitle
 * @param {boolean} isRedirect Whether the page is a redirect or not.
 */
ve.init.mw.DesktopArticleTarget.prototype.replacePageContent = function (
	html, categoriesHtml, displayTitle, lastModified, contentSub, isRedirect
) {
	var $content = $( $.parseHTML( html ) ),
		$veSectionLinks, $categories;

	if ( lastModified ) {
		// If we were not viewing the most recent revision before (a requirement
		// for lastmod to have been added by MediaWiki), we will be now.
		if ( !$( '#footer-info-lastmod' ).length ) {
			$( '#footer-info' ).prepend(
				$( '<li>' ).attr( 'id', 'footer-info-lastmod' )
			);
		}

		// Intentionally treated as HTML
		$( '#footer-info-lastmod' ).html( ' ' + mw.msg(
			'lastmodifiedat',
			lastModified.date,
			lastModified.time
		) );
	}
	// Remove any VE-added ve-redirect-header
	$( '.redirectMsg' ).removeClass( 've-redirect-header' );
	this.$originalRedirectMsg = undefined;
	this.$originalRedirectSub = undefined;

	// Re-set any edit section handlers now that the page content has been replaced
	if (
		// editsection but no editsection-visualeditor:
		// whole editsection triggers VE
		$content.find( '.mw-editsection' ).length &&
		!$content.find( '.mw-editsection-visualeditor' ).length
	) {
		$veSectionLinks = $content.find( '.mw-editsection a' );
	} else {
		// Otherwise, put it on the editsection-visualeditor links
		$veSectionLinks = $content.find( 'a.mw-editsection-visualeditor' );
	}
	$veSectionLinks.on( 'click', mw.libs.ve.onEditSectionLinkClick );

	mw.hook( 'wikipage.content' ).fire( this.$editableContent.empty().append( $content ) );
	if ( displayTitle ) {
		$( '#content #firstHeading' ).html( displayTitle );
	}

	$categories = $( $.parseHTML( categoriesHtml ) );
	mw.hook( 'wikipage.categories' ).fire( $categories );
	$( '#catlinks' ).replaceWith( $categories );
	this.$originalCategories = null;

	$( '#contentSub' ).html( contentSub );

	if ( isRedirect ) {
		$( '#contentSub' ).append(
			$( '<span>' )
				.text( mw.msg( 'redirectpagesub' ) )
				.attr( 'id', 'redirectsub' ),
			$( '<br>' )
		);
	}

	// Bit of a hack: Make sure any redirect note is styled
	$( '.redirectMsg' )
		.addClass( 'mw-content-' + $( 'html' ).attr( 'dir' ) )
		.addClass( 've-redirect-header' );
};

/**
 * Get the numeric index of a section in the page.
 *
 * @method
 * @param {HTMLElement} heading Heading element of section
 */
ve.init.mw.DesktopArticleTarget.prototype.getEditSection = function ( heading ) {
	var $page = $( '#mw-content-text' ),
		section = 0;
	$page.find( 'h1, h2, h3, h4, h5, h6' ).not( '#toc h2' ).each( function () {
		section++;
		if ( this === heading ) {
			return false;
		}
	} );
	return section;
};

/**
 * Store the section for which the edit link has been triggered.
 *
 * @method
 * @param {HTMLElement} heading Heading element of section
 */
ve.init.mw.DesktopArticleTarget.prototype.saveEditSection = function ( heading ) {
	this.section = this.getEditSection( heading );
};

/**
 * Add onunload and onbeforeunload handlers.
 *
 * @method
 */
ve.init.mw.DesktopArticleTarget.prototype.setupUnloadHandlers = function () {
	// Remember any already set beforeunload handler
	this.onBeforeUnloadFallback = window.onbeforeunload;
	// Attach our handlers
	window.onbeforeunload = this.onBeforeUnload.bind( this );
	window.addEventListener( 'unload', this.onUnloadHandler );
};
/**
 * Remove onunload and onbeforunload handlers.
 *
 * @method
 */
ve.init.mw.DesktopArticleTarget.prototype.teardownUnloadHandlers = function () {
	// Restore whatever previous onbeforeunload hook existed
	window.onbeforeunload = this.onBeforeUnloadFallback;
	this.onBeforeUnloadFallback = null;
	window.removeEventListener( 'unload', this.onUnloadHandler );
};

/**
 * Show the meta dialog as needed on load.
 */
ve.init.mw.DesktopArticleTarget.prototype.maybeShowMetaDialog = function () {
	var windowAction, redirectMetaItems,
		target = this;

	if ( this.welcomeDialogPromise ) {
		this.welcomeDialogPromise
			.always( function () {
				var noticesTool;
				// Pop out the notices when the welcome dialog is closed
				if (
					target.switched &&
					!mw.user.options.get( 'visualeditor-hidevisualswitchpopup' )
				) {
					target.actionsToolbar.tools.editModeSource.getPopup().toggle( true );
				} else {
					noticesTool = target.actionsToolbar.tools.notices;
					noticesTool.setNotices( target.getEditNotices() );
					noticesTool.getPopup().toggle( true );
				}
			} );
	}

	redirectMetaItems = this.getSurface().getModel().getMetaList().getItemsInGroup( 'mwRedirect' );
	if ( redirectMetaItems.length ) {
		this.onMetaItemInserted( redirectMetaItems[ 0 ], true );

		windowAction = ve.ui.actionFactory.create( 'window', this.getSurface() );

		windowAction.open( 'meta', { page: 'settings' } );
	}
};

/**
 * Handle before unload event.
 *
 * @method
 */
ve.init.mw.DesktopArticleTarget.prototype.onBeforeUnload = function () {
	var fallbackResult;
	// Check if someone already set on onbeforeunload hook
	if ( this.onBeforeUnloadFallback ) {
		// Get the result of their onbeforeunload hook
		fallbackResult = this.onBeforeUnloadFallback();
		// If it returned something, exit here and return their message
		if ( fallbackResult !== undefined ) {
			return fallbackResult;
		}
	}
	// Check if there's been an edit
	if (
		this.getSurface() &&
		$.contains( document, this.getSurface().$element.get( 0 ) ) &&
		this.edited &&
		!this.submitting &&
		mw.user.options.get( 'useeditwarning' )
	) {
		// Return our message
		return ve.msg( 'visualeditor-viewpage-savewarning' );
	}
};

/**
 * Handle unload event.
 *
 * @method
 */
ve.init.mw.DesktopArticleTarget.prototype.onUnload = function () {
	if ( !this.submitting ) {
		ve.track( 'mwedit.abort', {
			type: this.edited ? 'unknown-edited' : 'unknown',
			mechanism: 'navigate'
		} );
	}
};

/**
 * Switches to the wikitext editor, either keeping (default) or discarding changes.
 *
 * @param {boolean} [discardChanges] Whether to discard changes or not.
 * @param {boolean} [modified] Whether there were any changes at all.
 * @param {boolean} [leaveVE] Leave VE, even if source mode is available
 */
ve.init.mw.DesktopArticleTarget.prototype.switchToWikitextEditor = function ( discardChanges, modified, leaveVE ) {
	var uri, oldid, prefPromise, dataPromise,
		target = this;

	// We may have this.section but VE is always full page at the moment
	this.section = null;

	if ( ve.init.target.isModeAvailable( 'source' ) && !leaveVE ) {
		if ( discardChanges ) {
			dataPromise = mw.libs.ve.targetLoader.requestPageData(
				'source',
				this.pageName,
				this.section,
				this.requestedRevId,
				this.constructor.name
			).then(
				function ( response ) { return response; },
				function () {
					// TODO: Some sort of progress bar?
					target.switchToWikitextEditor( discardChanges, modified, true );
					// Keep everything else waiting so our error handler can do its business
					return $.Deferred().promise();
				}
			);
		} else {
			this.serialize( this.getDocToSave() );
			dataPromise = this.serializing.then( function ( response ) {
				// HACK - add parameters the API doesn't provide for a VE->WT switch
				var data = response.visualeditoredit;
				data.etag = target.etag;
				data.fromEditedState = modified;
				data.notices = target.remoteNotices;
				data.protectedClasses = target.protectedClasses;
				data.basetimestamp = target.baseTimeStamp;
				data.starttimestamp = target.startTimeStamp;
				data.oldid = target.revid;
				data.checkboxes = target.checkboxes;
				return response;
			} );
		}
		this.reloadSurface( 'source', dataPromise );
	} else {
		oldid = this.currentUri.query.oldid || $( 'input[name=parentRevId]' ).val();
		target = this;
		prefPromise = mw.libs.ve.setEditorPreference( 'wikitext' );

		if ( discardChanges ) {
			if ( modified ) {
				ve.track( 'mwedit.abort', { type: 'switchwithout', mechanism: 'navigate' } );
			} else {
				ve.track( 'mwedit.abort', { type: 'switchnochange', mechanism: 'navigate' } );
			}
			this.submitting = true;
			prefPromise.done( function () {
				uri = target.viewUri.clone().extend( {
					action: 'edit',
					veswitched: 1
				} );
				if ( oldid ) {
					uri.extend( { oldid: oldid } );
				}
				location.href = uri.toString();
			} );
		} else {
			this.serialize(
				this.getDocToSave(),
				function ( wikitext ) {
					ve.track( 'mwedit.abort', { type: 'switchwith', mechanism: 'navigate' } );
					target.submitWithSaveFields( { wpDiff: 1, wpAutoSummary: '' }, wikitext );
				}
			);
		}
	}
};

/**
 * Switch to the visual editor.
 */
ve.init.mw.DesktopArticleTarget.prototype.switchToVisualEditor = function () {
	var dataPromise, windowManager, switchWindow,
		target = this;

	if ( this.section !== null ) {
		// WT -> VE switching is not yet supported in sections, so
		// show a discard-only confirm dialog, then reload the whole page.
		windowManager = new OO.ui.WindowManager();
		switchWindow = new mw.libs.ve.SwitchConfirmDialog();
		$( 'body' ).append( windowManager.$element );
		windowManager.addWindows( [ switchWindow ] );
		windowManager.openWindow( switchWindow, { mode: 'simple' } )
			.then( function ( opened ) {
				return opened;
			} )
			.then( function ( closing ) { return closing; } )
			.then( function ( data ) {
				if ( data && data.action === 'discard' ) {
					target.section = null;
					target.reloadSurface( 'visual' );
				}
				windowManager.destroy();
			} );
	} else {
		dataPromise = mw.libs.ve.targetLoader.requestParsoidData(
			this.pageName,
			this.revid,
			this.constructor.name,
			this.edited,
			this.getDocToSave()
		);

		this.reloadSurface( 'visual', dataPromise );
	}
};

/**
 * Switch to a different wikitext section
 *
 * @param {number|string|null} section New section, number, 'new' or null (whole document)
 * @param {boolean} noConfirm Swtich without prompting (changes will be lost either way)
 */
ve.init.mw.DesktopArticleTarget.prototype.switchToWikitextSection = function ( section, noConfirm ) {
	var promise,
		target = this;
	if ( section === this.section ) {
		return;
	}
	if ( !noConfirm && this.edited && mw.user.options.get( 'useeditwarning' ) ) {
		promise = OO.ui.confirm( mw.msg( 'visualeditor-viewpage-savewarning' ) );
	} else {
		promise = $.Deferred().resolve( true ).promise();
	}
	promise.then( function ( confirmed ) {
		if ( confirmed ) {
			target.section = section;
			target.reloadSurface( 'source' );
			target.updateTabs( true );
		}
	} );
};

/**
 * Reload the target surface in the new editor mode
 *
 * @param {string} newMode New mode
 * @param {jQuery.Promise} [dataPromise] Data promise, if any
 */
ve.init.mw.DesktopArticleTarget.prototype.reloadSurface = function ( newMode, dataPromise ) {
	var target = this;

	this.setDefaultMode( newMode );
	// Create progress - will be discarded when surface is destroyed.
	this.getSurface().createProgress(
		$.Deferred().promise(),
		ve.msg( newMode === 'source' ? 'visualeditor-mweditmodesource-progress' : 'visualeditor-mweditmodeve-progress' ),
		true /* non-cancellable */
	);
	this.activating = true;
	this.activatingDeferred = $.Deferred();
	this.load( dataPromise );
	this.activatingDeferred.done( function () {
		target.updateHistoryState();
		target.afterActivate();
		target.setupTriggerListeners();
	} );
	this.toolbarSetupDeferred.resolve();
};

/**
 * Get a wikitext fragment from a document
 *
 * @param {ve.dm.Document} doc Document
 * @param {boolean} [useRevision=true] Whether to use the revision ID + ETag
 * @return {jQuery.Promise} Abortable promise which resolves with a wikitext string
 */
ve.init.mw.DesktopArticleTarget.prototype.getWikitextFragment = function ( doc, useRevision ) {
	var promise, xhr,
		params = {
			action: 'visualeditoredit',
			token: this.editToken,
			paction: 'serialize',
			html: ve.dm.converter.getDomFromModel( doc ).body.innerHTML,
			page: this.pageName
		};

	if ( useRevision === undefined || useRevision ) {
		params.oldid = this.revid;
		params.etag = this.etag;
	}

	xhr = new mw.Api().post(
		params,
		{ contentType: 'multipart/form-data' }
	);

	promise = xhr.then( function ( response ) {
		if ( response.visualeditoredit ) {
			return response.visualeditoredit.content;
		}
		return $.Deferred().reject();
	} );

	promise.abort = function () {
		xhr.abort();
	};

	return promise;
};

/**
 * Resets the document opacity when we've decided to cancel switching to the wikitext editor.
 */
ve.init.mw.DesktopArticleTarget.prototype.resetDocumentOpacity = function () {
	this.getSurface().getView().getDocument().getDocumentNode().$element.css( 'opacity', 1 );
};

/* Registration */

ve.init.mw.targetFactory.register( ve.init.mw.DesktopArticleTarget );
