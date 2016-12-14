/*!
 * VisualEditor MediaWiki Initialization ArticleTarget class.
 *
 * @copyright 2011-2016 VisualEditor Team and others; see AUTHORS.txt
 * @license The MIT License (MIT); see LICENSE.txt
 */

/* global EasyDeflate, alert */

/**
 * Initialization MediaWiki article target.
 *
 * @class
 * @extends ve.init.mw.Target
 *
 * @constructor
 * @param {string} pageName Name of target page
 * @param {string} [revisionId] If the editor should load a revision of the page, pass the
 *  revision id here. Defaults to loading the latest version (see #load).
 * @param {Object} [config] Configuration options
 */
ve.init.mw.ArticleTarget = function VeInitMwArticleTarget( pageName, revisionId, config ) {
	config = config || {};
	config.toolbarConfig = $.extend( {
		shadow: true,
		actions: true,
		floatable: true
	}, config.toolbarConfig );

	// Parent constructor
	ve.init.mw.ArticleTarget.super.call( this, config );

	// Properties
	this.saveDialog = null;
	this.saveDeferred = null;
	this.captcha = null;
	this.docToSave = null;
	this.toolbarSaveButton = null;
	this.pageName = pageName;
	this.pageExists = mw.config.get( 'wgRelevantArticleId', 0 ) !== 0;
	this.toolbarScrollOffset = mw.config.get( 'wgVisualEditorToolbarScrollOffset', 0 );
	this.section = null;
	this.sectionTitle = null;

	this.checkboxFields = null;
	this.checkboxesByName = null;
	this.$otherFields = null;

	// Sometimes we actually don't want to send a useful oldid
	// if we do, PostEdit will give us a 'page restored' message
	this.requestedRevId = revisionId && parseInt( revisionId );
	this.currentRevisionId = mw.config.get( 'wgCurRevisionId' );
	this.revid = this.requestedRevId || this.currentRevisionId;

	this.restoring = !!this.requestedRevId && this.requestedRevId !== this.currentRevisionId;
	this.pageDeletedWarning = false;
	this.editToken = mw.user.tokens.get( 'editToken' );
	this.submitUrl = ( new mw.Uri( mw.util.getUrl( this.pageName ) ) )
		.extend( {
			action: 'submit',
			veswitched: 1
		} );
	this.events = { track: $.noop, trackActivationStart: $.noop, trackActivationComplete: $.noop };

	this.welcomeDialog = null;
	this.welcomeDialogPromise = null;

	this.preparedCacheKeyPromise = null;
	this.clearState();

	// Initialization
	this.$element.addClass( 've-init-mw-articleTarget' );
};

/* Inheritance */

OO.inheritClass( ve.init.mw.ArticleTarget, ve.init.mw.Target );

/* Events */

/**
 * @event editConflict
 */

/**
 * @event save
 */

/**
 * @event showChanges
 */

/**
 * @event noChanges
 */

/**
 * @event saveErrorEmpty
 * Fired when save API returns no data object
 */

/**
 * @event saveErrorSpamBlacklist
 * Fired when save is considered spam or blacklisted
 */

/**
 * @event saveErrorAbuseFilter
 * Fired when AbuseFilter throws warnings
 */

/**
 * @event saveErrorBadToken
 * @param {boolean} willRetry Whether an automatic retry will occur
 * Fired on save if we have to fetch a new edit token.
 * This is mainly for analytical purposes.
 */

/**
 * @event saveErrorNewUser
 * Fired when user is logged in as a new user
 */

/**
 * @event saveErrorCaptcha
 * Fired when saveError indicates captcha field is required
 */

/**
 * @event saveErrorUnknown
 * @param {string} errorMsg Error message shown to the user
 * Fired for any other type of save error
 */

/**
 * @event saveErrorPageDeleted
 * Fired when user tries to save page that was deleted after opening VE
 */

/**
 * @event saveErrorTitleBlacklist
 * Fired when the user tries to save page in violation of the TitleBlacklist
 */

/**
 * @event saveErrorReadOnly
 * Fired when the user tries to save page but the database is locked
 */

/**
 * @event loadError
 */

/**
 * @event showChangesError
 */

/**
 * @event serializeError
 */

/**
 * @event serializeComplete
 * Fired when serialization is complete
 */

/* Static Properties */

/**
 * @inheritdoc
 */
ve.init.mw.ArticleTarget.static.name = 'article';

/**
 * Tracking name of target class. Used by ArticleTargetEvents to identify which target we are tracking.
 *
 * @static
 * @property {string}
 * @inheritable
 */
ve.init.mw.ArticleTarget.static.trackingName = 'mwTarget';

/**
 * @inheritdoc
 */
ve.init.mw.ArticleTarget.static.integrationType = 'page';

/**
 * @inheritdoc
 */
ve.init.mw.ArticleTarget.static.platformType = 'other';

/* Methods */

/**
 * @inheritdoc
 */
ve.init.mw.ArticleTarget.prototype.setDefaultMode = function () {
	var oldDefaultMode = this.defaultMode;
	// Parent method
	ve.init.mw.ArticleTarget.super.prototype.setDefaultMode.apply( this, arguments );

	if ( this.defaultMode !== oldDefaultMode ) {
		this.updateTabs( true );
		if ( mw.libs.ve.setEditorPreference ) {
			// only set up by DAT.init
			mw.libs.ve.setEditorPreference( this.defaultMode === 'visual' ? 'visualeditor' : 'wikitext' );
		}
	}
};

/**
 * Update state of editing tabs
 *
 * @param {boolean} editing Whether the editor is loaded.
 */
ve.init.mw.ArticleTarget.prototype.updateTabs = function ( editing ) {
	var tab;

	// Deselect current mode (e.g. "view" or "history"). In skins like monobook that don't have
	// separate tab sections for content actions and namespaces the below is a no-op.
	$( '#p-views' ).find( 'li.selected' ).removeClass( 'selected' );

	if ( editing ) {
		if ( this.section === 'new' ) {
			tab = 'addsection';
		} else if ( $( '#ca-ve-edit' ).length ) {
			if ( this.getDefaultMode() === 'visual' ) {
				tab = 've-edit';
			} else {
				tab = 'edit';
			}
		} else {
			// Single edit tab
			tab = 'edit';
		}
	} else {
		tab = 'view';
	}
	$( '#ca-' + tab ).addClass( 'selected' );
};

/**
 * Handle response to a successful load request.
 *
 * This method is called within the context of a target instance. If successful the DOM from the
 * server will be parsed, stored in {this.doc} and then {this.documentReady} will be called.
 *
 * @method
 * @param {Object} response API response data
 * @param {string} status Text status message
 */
ve.init.mw.ArticleTarget.prototype.loadSuccess = function ( response ) {
	var i, len, linkData, aboutDoc, docRevId, docRevIdMatches, $checkboxes, defaults,
		target = this,
		data = response ? ( response.visualeditor || response.visualeditoredit ) : null;

	if ( !data || typeof data.content !== 'string' ) {
		this.loadFail( 'No HTML content in response from server', 've-api' );
	} else {
		ve.track( 'trace.parseResponse.enter' );
		this.originalHtml = data.content;
		this.etag = data.etag;
		this.fromEditedState = data.fromEditedState;
		this.switched = data.switched || 'wteswitched' in new mw.Uri( location.href ).query;
		this.doc = this.parseDocument( this.originalHtml, this.getDefaultMode() );

		this.remoteNotices = ve.getObjectValues( data.notices );
		this.protectedClasses = data.protectedClasses;

		this.baseTimeStamp = data.basetimestamp;
		this.startTimeStamp = data.starttimestamp;
		this.revid = data.oldid;

		aboutDoc = this.doc.documentElement.getAttribute( 'about' );
		if ( aboutDoc ) {
			docRevIdMatches = aboutDoc.match( /revision\/([0-9]*)$/ );
			if ( docRevIdMatches.length >= 2 ) {
				docRevId = parseInt( docRevIdMatches[ 1 ] );
			}
		}
		if ( docRevId && docRevId !== this.revid ) {
			if ( this.retriedRevIdConflict ) {
				// Retried already, just error the second time.
				this.loadFail(
					'Revision IDs (doc=' + docRevId + ',api=' + this.revid + ') ' +
						'returned by server do not match',
					've-api'
				);
			} else {
				this.retriedRevIdConflict = true;
				// TODO this retries both requests, in RESTbase mode we should only retry
				// the request that gave us the lower revid
				this.loading = false;
				// HACK: Load with explicit revid to hopefully prevent this from happening again
				this.requestedRevId = Math.max( docRevId, this.revid );
				this.load();
			}
			return;
		} else {
			// Set this to false after a successful load, so we don't immediately give up
			// if a subsequent load mismatches again
			this.retriedRevIdConflict = false;
		}

		// Populate link cache
		if ( data.links ) {
			// Format from the API: { missing: [titles], known: 1|[titles] }
			// Format expected by LinkCache: { title: { missing: true|false } }
			linkData = {};
			for ( i = 0, len = data.links.missing.length; i < len; i++ ) {
				linkData[ data.links.missing[ i ] ] = { missing: true };
			}
			if ( data.links.known === 1 ) {
				// Set back to false by surfaceReady()
				ve.init.platform.linkCache.setAssumeExistence( true );
			} else {
				for ( i = 0, len = data.links.known.length; i < len; i++ ) {
					linkData[ data.links.known[ i ] ] = { missing: false };
				}
			}
			ve.init.platform.linkCache.setMissing( linkData );
		}

		ve.track( 'trace.parseResponse.exit' );
		// Everything worked, the page was loaded, continue initializing the editor
		this.documentReady( this.doc );
	}

	data = response ? ( response.visualeditor || response.visualeditoredit ) : {};

	this.checkboxFields = [];
	this.checkboxesByName = {};
	this.$otherFields = $( [] );
	if ( [ 'edit', 'submit' ].indexOf( mw.util.getParamValue( 'action' ) ) !== -1 ) {
		$( '#content #firstHeading' ).text(
			mw.Title.newFromText( mw.config.get( 'wgPageName' ) ).getPrefixedText()
		);
	}

	if ( data.checkboxes ) {
		defaults = {};
		$( '.editCheckboxes input' ).each( function () {
			defaults[ this.name ] = this.checked;
		} );

		$checkboxes = $( '<div>' ).html( ve.getObjectValues( data.checkboxes ).join( '' ) );
		$checkboxes.find( 'input[type=checkbox]' ).each( function () {
			var $label, title, checkbox,
				$this = $( this ),
				name = $this.attr( 'name' ),
				id = $this.attr( 'id' );

			if ( !name ) {
				// This really shouldn't happen..
				return;
			}

			// Label with for=id
			if ( id ) {
				$label = $checkboxes.find( 'label[for=' + id + ']' );
			}
			// Label wrapped input
			if ( !$label ) {
				$label = $this.closest( 'label' );
			}
			if ( $label ) {
				title = $label.attr( 'title' );
				$label.find( 'a' ).attr( 'target', '_blank' );
			}
			checkbox = new OO.ui.CheckboxInputWidget( {
				value: $this.attr( 'value' ),
				selected: defaults[ name ] !== undefined ? defaults[ name ] : $this.prop( 'checked' ),
				classes: [ 've-ui-mwSaveDialog-checkbox-' + name ]
			} );
			// HACK: CheckboxInputWidget doesn't support access keys
			checkbox.$input.attr( 'accesskey', $( this ).attr( 'accesskey' ) );
			target.checkboxFields.push(
				new OO.ui.FieldLayout( checkbox, {
					align: 'inline',
					label: $label ? $label.contents() : undefined,
					title: title
				} )
			);
			target.checkboxesByName[ name ] = checkbox;
		} );
		this.$otherFields = $checkboxes.find( 'input[type!=checkbox]' );
	}
};

/**
 * @inheritdoc
 */
ve.init.mw.ArticleTarget.prototype.documentReady = function () {
	// We need to wait until documentReady as local notices may require special messages
	this.editNotices = this.remoteNotices.concat(
		this.localNoticeMessages.map( function ( msgKey ) {
			return '<p>' + ve.init.platform.getParsedMessage( msgKey ) + '</p>';
		} )
	);

	this.loading = false;
	this.edited = this.fromEditedState;

	// Parent method
	ve.init.mw.ArticleTarget.super.prototype.documentReady.apply( this, arguments );
};

/**
 * @inheritdoc
 */
ve.init.mw.ArticleTarget.prototype.surfaceReady = function () {
	// loadSuccess() may have called setAssumeExistence( true );
	ve.init.platform.linkCache.setAssumeExistence( false );
	this.getSurface().getModel().connect( this, {
		history: 'updateToolbarSaveButtonState'
	} );
	this.restoreEditSection();

	// Parent method
	ve.init.mw.ArticleTarget.super.prototype.surfaceReady.apply( this, arguments );
};

/**
 * Handle an unsuccessful load request.
 *
 * This method is called within the context of a target instance.
 *
 * @method
 * @param {Object} error Object containing xhr, textStatus and exception keys
 * @param {string} errorTypeText Error type text from mw.Api
 * @fires loadError
 */
ve.init.mw.ArticleTarget.prototype.loadFail = function () {
	this.loading = false;
	this.emit( 'loadError' );
};

/**
 * Handle a successful save request.
 *
 * This method is called within the context of a target instance.
 *
 * @method
 * @param {HTMLDocument} doc HTML document we tried to save
 * @param {Object} saveData Options that were used
 * @param {Object} response Response data
 * @param {string} status Text status message
 */
ve.init.mw.ArticleTarget.prototype.saveSuccess = function ( doc, saveData, response ) {
	var data = response.visualeditoredit;
	this.saving = false;
	if ( !data ) {
		this.saveFail( doc, saveData, null, 'Invalid response from server', response );
	} else if ( data.result !== 'success' ) {
		// Note, this could be any of db failure, hookabort, badtoken or even a captcha
		this.saveFail( doc, saveData, null, 'Save failure', response );
	} else if ( typeof data.content !== 'string' ) {
		this.saveFail( doc, saveData, null, 'Invalid HTML content in response from server', response );
	} else {
		this.saveComplete(
			data.content,
			data.categorieshtml,
			data.newrevid,
			data.isRedirect,
			data.displayTitleHtml,
			data.lastModified,
			data.contentSub,
			data.modules,
			data.jsconfigvars
		);
	}
};

/**
 * Handle successful DOM save event.
 *
 * @method
 * @param {string} html Rendered page HTML from server
 * @param {string} categoriesHtml Rendered categories HTML from server
 * @param {number} newid New revision id, undefined if unchanged
 * @param {boolean} isRedirect Whether this page is a redirect or not
 * @param {string} displayTitle What HTML to show as the page title
 * @param {Object} lastModified Object containing user-formatted date
 *  and time strings, or undefined if we made no change.
 * @param {string} contentSub HTML to show as the content subtitle
 * @param {Array} modules The modules to be loaded on the page
 * @param {Object} jsconfigvars The mw.config values needed on the page
 * @fires save
 */
ve.init.mw.ArticleTarget.prototype.saveComplete = function () {
	this.saveDeferred.resolve();
	this.emit( 'save' );
};

/**
 * Handle an unsuccessful save request.
 *
 * @method
 * @param {HTMLDocument} doc HTML document we tried to save
 * @param {Object} saveData Options that were used
 * @param {Object} jqXHR
 * @param {string} status Text status message
 * @param {Object|null} data API response data
 */
ve.init.mw.ArticleTarget.prototype.saveFail = function ( doc, saveData, jqXHR, status, data ) {
	var api, editApi,
		target = this;

	this.saving = false;
	this.pageDeletedWarning = false;

	// Handle empty response
	if ( !data ) {
		this.saveErrorEmpty();
		return;
	}

	editApi = data && data.visualeditoredit && data.visualeditoredit.edit;

	// Handle spam blacklist error (either from core or from Extension:SpamBlacklist)
	if ( editApi && editApi.spamblacklist ) {
		this.saveErrorSpamBlacklist( editApi );
		return;
	}

	// Handle warnings/errors from Extension:AbuseFilter
	// TODO: Move this to a plugin
	if ( editApi && editApi.info && editApi.info.indexOf( 'Hit AbuseFilter:' ) === 0 && editApi.warning ) {
		this.saveErrorAbuseFilter( editApi );
		return;
	}

	// Handle token errors
	if ( data.error && data.error.code === 'badtoken' ) {
		api = new mw.Api();
		api.get( {
			action: 'query',
			meta: 'tokens|userinfo',
			type: 'csrf'
		} )
			.done( function ( data ) {
				var
					userInfo = data.query && data.query.userinfo,
					editToken = data.query && data.query.tokens && data.query.tokens.csrftoken,
					isAnon = mw.user.isAnon();

				if ( userInfo && editToken ) {
					target.editToken = editToken;

					if (
						( isAnon && userInfo.anon !== undefined ) ||
							// Comparing id instead of name to protect against possible
							// normalisation and against case where the user got renamed.
							mw.config.get( 'wgUserId' ) === userInfo.id
					) {
						// New session is the same user still; retry
						target.emit( 'saveErrorBadToken', true );
						target.save( doc, saveData );
					} else {
						// The now current session is a different user
						if ( userInfo.anon !== undefined ) {
							// New session is an anonymous user
							mw.config.set( {
								// wgUserId is unset for anonymous users, not set to null
								wgUserId: undefined,
								// wgUserName is explicitly set to null for anonymous users,
								// functions like mw.user.isAnon rely on this.
								wgUserName: null
							} );
							target.saveErrorBadToken( null, false );
						} else {
							// New session is a different user
							mw.config.set( { wgUserId: userInfo.id, wgUserName: userInfo.name } );
							target.saveErrorBadToken( userInfo.name, false );
						}
					}
				}
			} )
			.fail( function () {
				target.saveErrorBadToken( null, true );
			} );
		return;
	} else if ( data.error && data.error.code === 'editconflict' ) {
		this.editConflict();
		return;
	} else if ( data.error && data.error.code === 'pagedeleted' ) {
		this.saveErrorPageDeleted();
		return;
	} else if ( data.error && data.error.code === 'titleblacklist-forbidden' ) {
		this.saveErrorTitleBlacklist();
		return;
	} else if ( data.error && data.error.code === 'readonly' ) {
		this.saveErrorReadOnly( data.error.readonlyreason );
		return;
	}

	// Handle captcha
	// Captcha "errors" usually aren't errors. We simply don't know about them ahead of time,
	// so we save once, then (if required) we get an error with a captcha back and try again after
	// the user solved the captcha.
	// TODO: ConfirmEdit API is horrible, there is no reliable way to know whether it is a "math",
	// "question" or "fancy" type of captcha. They all expose differently named properties in the
	// API for different things in the UI. At this point we only support the SimpleCaptcha and FancyCaptcha
	// which we very intuitively detect by the presence of a "url" property.
	if ( editApi && editApi.captcha && (
		editApi.captcha.url ||
		editApi.captcha.type === 'simple' ||
		editApi.captcha.type === 'math' ||
		editApi.captcha.type === 'question'
	) ) {
		this.saveErrorCaptcha( editApi );
		return;
	}

	// Handle (other) unknown and/or unrecoverable errors
	this.saveErrorUnknown( editApi, data );
};

/**
 * Handle a successful show changes request.
 *
 * @method
 * @param {Object} response API response data
 * @param {string} status Text status message
 */
ve.init.mw.ArticleTarget.prototype.showChangesSuccess = function ( response ) {
	var data = response.visualeditoredit;
	this.diffing = false;
	if ( !data && !response.error ) {
		this.showChangesFail( null, 'Invalid response from server', null );
	} else if ( response.error ) {
		this.showChangesFail(
			null, 'Unsuccessful request: ' + response.error.info, null
		);
	} else if ( data.result === 'nochanges' ) {
		this.noChanges();
	} else if ( data.result !== 'success' ) {
		this.showChangesFail( null, 'Failed request: ' + data.result, null );
	} else if ( typeof data.diff !== 'string' ) {
		this.showChangesFail(
			null, 'Invalid HTML content in response from server', null
		);
	} else {
		this.showChangesDiff( data.diff );
	}
};

/**
 * Show changes diff HTML
 *
 * @param {string} diffHtml Diff HTML
 * @fires showChanges
 */
ve.init.mw.ArticleTarget.prototype.showChangesDiff = function ( diffHtml ) {
	this.emit( 'showChanges' );

	// Invalidate the viewer diff on next change
	this.getSurface().getModel().getDocument().once( 'transact',
		this.saveDialog.clearDiff.bind( this.saveDialog )
	);
	this.saveDialog.setDiffAndReview( diffHtml );
};

/**
 * Handle errors during showChanges action.
 *
 * @method
 * @this ve.init.mw.ArticleTarget
 * @param {Object} jqXHR
 * @param {string} status Text status message
 * @param {Mixed} error HTTP status text
 * @fires showChangesError
 */
ve.init.mw.ArticleTarget.prototype.showChangesFail = function ( jqXHR, status ) {
	this.diffing = false;
	this.emit( 'showChangesError' );

	OO.ui.alert( ve.msg( 'visualeditor-differror', status ) );

	this.saveDialog.popPending();
};

/**
 * Show an save process error message
 *
 * @method
 * @param {string|jQuery|Node[]} msg Message content (string of HTML, jQuery object or array of
 *  Node objects)
 * @param {boolean} [allowReapply=true] Whether or not to allow the user to reapply.
 *  Reset when swapping panels. Assumed to be true unless explicitly set to false.
 * @param {boolean} [warning=false] Whether or not this is a warning.
 */
ve.init.mw.ArticleTarget.prototype.showSaveError = function ( msg, allowReapply, warning ) {
	this.saveDeferred.reject( [ new OO.ui.Error( msg, { recoverable: allowReapply, warning: warning } ) ] );
};

/**
 * Handle general save error
 *
 * @method
 * @fires saveErrorEmpty
 */
ve.init.mw.ArticleTarget.prototype.saveErrorEmpty = function () {
	this.showSaveError( ve.msg( 'visualeditor-saveerror', 'Empty server response' ), false /* prevents reapply */ );
	this.emit( 'saveErrorEmpty' );
};

/**
 * Handle spam blacklist error
 *
 * @method
 * @param {Object} editApi
 * @fires saveErrorSpamBlacklist
 */
ve.init.mw.ArticleTarget.prototype.saveErrorSpamBlacklist = function ( editApi ) {
	this.showSaveError(
		$( $.parseHTML( editApi.sberrorparsed ) ),
		false // prevents reapply
	);
	this.emit( 'saveErrorSpamBlacklist' );
};

/**
 * Handel abuse filter error
 *
 * @method
 * @param {Object} editApi
 * @fires saveErrorAbuseFilter
 */
ve.init.mw.ArticleTarget.prototype.saveErrorAbuseFilter = function ( editApi ) {
	this.showSaveError( $( $.parseHTML( editApi.warning ) ) );
	// Don't disable the save button. If the action is not disallowed the user may save the
	// edit by pressing Save again. The AbuseFilter API currently has no way to distinguish
	// between filter triggers that are and aren't disallowing the action.
	this.emit( 'saveErrorAbuseFilter' );
};

/**
 * Handle title blacklist save error
 *
 * @method
 * @fires saveErrorTitleBlacklist
 */
ve.init.mw.ArticleTarget.prototype.saveErrorTitleBlacklist = function () {
	this.showSaveError( mw.msg( 'visualeditor-saveerror-titleblacklist' ) );
	this.emit( 'saveErrorTitleBlacklist' );
};

/**
 * Handle token fetch indicating another user is logged in, and token fetch errors.
 *
 * @method
 * @param {string|null} username Name of newly logged-in user, or null if anonymous
 * @param {boolean} [error=false] Whether there was an error trying to figure out who we're logged in as
 * @fires saveErrorBadToken
 * @fires saveErrorNewUser
 */
ve.init.mw.ArticleTarget.prototype.saveErrorBadToken = function ( username, error ) {
	var userMsg,
		$msg = $( document.createTextNode( mw.msg( 'visualeditor-savedialog-error-badtoken' ) + ' ' ) );

	if ( error ) {
		this.emit( 'saveErrorBadToken', false );
		$msg = $msg.add( document.createTextNode( mw.msg( 'visualeditor-savedialog-identify-trylogin' ) ) );
	} else {
		this.emit( 'saveErrorNewUser' );
		if ( username === null ) {
			userMsg = 'visualeditor-savedialog-identify-anon';
		} else {
			userMsg = 'visualeditor-savedialog-identify-user';
		}
		$msg = $msg.add( $.parseHTML( mw.message( userMsg, username ).parse() ) );
	}
	this.showSaveError( $msg );
};

/**
 * Handle unknown save error
 *
 * @method
 * @param {Object} editApi
 * @param {Object|null} data API response data
 * @fires saveErrorUnknown
 */
ve.init.mw.ArticleTarget.prototype.saveErrorUnknown = function ( editApi, data ) {
	var errorMsg = ( editApi && editApi.info ) || ( data && data.error && data.error.info ),
		errorCode = ( editApi && editApi.code ) || ( data && data.error && data.error.code );

	this.showSaveError(
		$( document.createTextNode( errorMsg || errorCode || 'Unknown error' ) ),
		false // prevents reapply
	);
	this.emit( 'saveErrorUnknown', errorCode || errorMsg || 'Unknown error' );
};

/**
 * Handle captcha error
 *
 * @method
 * @param {Object} editApi
 * @fires saveErrorCaptcha
 */
ve.init.mw.ArticleTarget.prototype.saveErrorCaptcha = function ( editApi ) {
	var $captchaDiv = $( '<div>' ),
		$captchaParagraph = $( '<p>' );

	this.captcha = {
		input: new OO.ui.TextInputWidget(),
		id: editApi.captcha.id
	};
	$captchaDiv.append( $captchaParagraph );
	$captchaParagraph.append(
		$( '<strong>' ).text( mw.msg( 'captcha-label' ) ),
		document.createTextNode( mw.msg( 'colon-separator' ) )
	);
	if ( editApi.captcha.url ) {
		// FancyCaptcha
		// Based on FancyCaptcha::getFormInformation() (https://git.io/v6mml) and
		// ext.confirmEdit.fancyCaptcha.js in the ConfirmEdit extension.
		mw.loader.load( 'ext.confirmEdit.fancyCaptcha' );
		$captchaDiv.addClass( 'fancycaptcha-captcha-container' );
		$captchaParagraph.append(
			$( $.parseHTML( mw.message( 'fancycaptcha-edit' ).parse() ) )
				.filter( 'a' ).attr( 'target', '_blank' ).end()
		);
		$captchaDiv.append(
			$( '<img>' ).attr( 'src', editApi.captcha.url ).addClass( 'fancycaptcha-image' ),
			' ',
			$( '<a>' ).addClass( 'fancycaptcha-reload' ).text( mw.msg( 'fancycaptcha-reload-text' ) )
		);
	} else if ( editApi.captcha.type === 'simple' || editApi.captcha.type === 'math' ) {
		// SimpleCaptcha and MathCaptcha
		$captchaParagraph.append(
			mw.message( 'captcha-edit' ).parse(),
			'<br>',
			document.createTextNode( editApi.captcha.question )
		);
	} else if ( editApi.captcha.type === 'question' ) {
		// QuestyCaptcha
		$captchaParagraph.append(
			mw.message( 'questycaptcha-edit' ).parse(),
			'<br>',
			editApi.captcha.question
		);
	}

	$captchaDiv.append( this.captcha.input.$element );

	// ProcessDialog's error system isn't great for this yet.
	this.saveDialog.clearMessage( 'api-save-error' );
	this.saveDialog.showMessage( 'api-save-error', $captchaDiv );
	this.saveDialog.popPending();

	this.saveDialog.updateSize();

	this.captcha.input.focus();

	this.emit( 'saveErrorCaptcha' );
};

/**
 * Handle page deleted error
 *
 * @method
 * @fires saveErrorPageDeleted
 */
ve.init.mw.ArticleTarget.prototype.saveErrorPageDeleted = function () {
	this.pageDeletedWarning = true;
	this.showSaveError( mw.msg( 'visualeditor-recreate', mw.msg( 'ooui-dialog-process-continue' ) ), true, true );
	this.emit( 'saveErrorPageDeleted' );
};

/**
 * Handle read only error
 *
 * @method
 * @param {string} reason The reason given by the system administrator.
 * @fires saveErrorReadOnly
 */
ve.init.mw.ArticleTarget.prototype.saveErrorReadOnly = function ( reason ) {
	this.showSaveError( $( $.parseHTML( mw.message( 'readonlywarning', reason ).parse() ) ), true, true );
	this.emit( 'saveErrorReadOnly' );
};

/**
 * Handle an edit conflict
 *
 * @method
 * @fires editConflict
 */
ve.init.mw.ArticleTarget.prototype.editConflict = function () {
	this.emit( 'editConflict' );
	this.saveDialog.popPending();
	this.saveDialog.swapPanel( 'conflict' );
};

/**
 * Handle no changes in diff
 *
 * @method
 * @fires noChanges
 */
ve.init.mw.ArticleTarget.prototype.noChanges = function () {
	this.emit( 'noChanges' );
	this.saveDialog.popPending();
	this.saveDialog.swapPanel( 'nochanges' );
	this.saveDialog.getActions().setAbilities( { approve: true } );
};

/**
 * Handle a successful serialize request.
 *
 * This method is called within the context of a target instance.
 *
 * @static
 * @method
 * @param {Object} response API response data
 * @param {string} status Text status message
 * @fires serializeComplete
 */
ve.init.mw.ArticleTarget.prototype.serializeSuccess = function ( response ) {
	var data = response.visualeditoredit;
	this.serializing = false;
	if ( !data && !response.error ) {
		this.serializeFail( null, 'Invalid response from server', null );
	} else if ( response.error ) {
		this.serializeFail(
			null, 'Unsuccessful request: ' + response.error.info, null
		);
	} else if ( data.result === 'error' ) {
		this.serializeFail( null, 'Server error', null );
	} else if ( typeof data.content !== 'string' ) {
		this.serializeFail(
			null, 'No Wikitext content in response from server', null
		);
	} else {
		if ( typeof this.serializeCallback === 'function' ) {
			this.serializeCallback( data.content );
			this.emit( 'serializeComplete' );
			delete this.serializeCallback;
		}
	}
};

/**
 * Handle an unsuccessful serialize request.
 *
 * This method is called within the context of a target instance.
 *
 * @method
 * @param {jqXHR|null} jqXHR
 * @param {string} status Text status message
 * @param {Mixed|null} error HTTP status text
 * @fires serializeError
 */
ve.init.mw.ArticleTarget.prototype.serializeFail = function () {
	this.serializing = false;
	this.emit( 'serializeError' );
};

/**
 * Handle clicks on the review button in the save dialog.
 *
 * @method
 * @fires saveReview
 */
ve.init.mw.ArticleTarget.prototype.onSaveDialogReview = function () {
	if ( !this.saveDialog.$reviewViewer.find( 'table, pre' ).length ) {
		this.emit( 'saveReview' );
		this.saveDialog.getActions().setAbilities( { approve: false } );
		this.saveDialog.pushPending();
		if ( this.pageExists ) {
			// Has no callback, handled via target.showChangesDiff
			this.showChanges( this.getDocToSave() );
		} else {
			this.serialize( this.getDocToSave(), this.onSaveDialogReviewComplete.bind( this ) );
		}
	} else {
		this.saveDialog.swapPanel( 'review' );
	}
};

/**
 * Handle clicks on the show preview button in the save dialog.
 *
 * @method
 * @fires savePreview
 */
ve.init.mw.ArticleTarget.prototype.onSaveDialogPreview = function () {
	var wikitext,
		target = this;
	if ( !this.saveDialog.$previewViewer.children().length ) {
		this.emit( 'savePreview' );
		this.saveDialog.getActions().setAbilities( { approve: false } );
		this.saveDialog.pushPending();

		wikitext = this.getDocToSave();
		if ( this.sectionTitle && this.sectionTitle.getValue() ) {
			wikitext = '== ' + this.sectionTitle.getValue() + ' ==\n\n' + wikitext;
		}

		new mw.Api().post( {
			action: 'visualeditor',
			paction: 'parsefragment',
			page: mw.config.get( 'wgRelevantPageName' ),
			wikitext: wikitext,
			pst: true
		} ).always( function ( response, details ) {
			if ( ve.getProp( response, 'visualeditor', 'result' ) === 'success' ) {
				target.saveDialog.showPreview( response.visualeditor.content );
			} else {
				target.saveDialog.showPreview( $( '<em>' ).text(
					ve.msg( 'visualeditor-loaderror-message', ve.getProp( details, 'error', 'info' ) || 'Failed to connect' )
				).html() );
			}
			target.bindSaveDialogClearDiff();
		} );
	} else {
		this.saveDialog.swapPanel( 'preview' );
	}
};

/**
 * Clear the save dialog's diff cache when the document changes
 */
ve.init.mw.ArticleTarget.prototype.bindSaveDialogClearDiff = function () {
	// Invalidate the viewer wikitext on next change
	this.getSurface().getModel().getDocument().once( 'transact',
		this.saveDialog.clearDiff.bind( this.saveDialog )
	);
	if ( this.sectionTitle ) {
		this.sectionTitle.once( 'change', this.saveDialog.clearDiff.bind( this.saveDialog ) );
	}
};

/**
 * Handle completed serialize request for diff views for new page creations.
 *
 * @method
 * @param {string} wikitext
 */
ve.init.mw.ArticleTarget.prototype.onSaveDialogReviewComplete = function ( wikitext ) {
	this.bindSaveDialogClearDiff();
	this.saveDialog.setDiffAndReview( $( '<pre>' ).text( wikitext ) );
};

/**
 * Handle clicks on the resolve conflict button in the conflict dialog.
 *
 * @method
 */
ve.init.mw.ArticleTarget.prototype.onSaveDialogResolveConflict = function () {
	// Get Wikitext from the DOM, and set up a submit call when it's done
	this.serialize(
		this.getDocToSave(),
		this.submitWithSaveFields.bind( this, { wpSave: 1 } )
	);
};

/**
 * Handle dialog retry events
 * So we can handle trying to save again after page deletion warnings
 */
ve.init.mw.ArticleTarget.prototype.onSaveDialogRetry = function () {
	if ( this.pageDeletedWarning ) {
		this.recreating = true;
		this.pageExists = false;
	}
};

/**
 * Handle dialog close events.
 *
 * @fires saveWorkflowEnd
 */
ve.init.mw.ArticleTarget.prototype.onSaveDialogClose = function () {
	this.emit( 'saveWorkflowEnd' );
};

/**
 * Get deflated HTML. This function is async because easy-deflate may not have finished loading yet.
 *
 * @param {HTMLDocument} newDoc Document to get HTML for
 * @return {jQuery.Promise} Promise resolved with deflated HTML
 * @see #getHtml
 */
ve.init.mw.ArticleTarget.prototype.deflateHtml = function ( newDoc ) {
	var html = this.getHtml( newDoc, this.doc );
	return mw.loader.using( 'easy-deflate.deflate' )
		.then( function () {
			return EasyDeflate.deflate( html );
		} );
};

/**
 * Load the editor.
 *
 * This method initiates an API request for the page data unless dataPromise is passed in,
 * in which case it waits for that promise instead.
 *
 * @param {jQuery.Promise} [dataPromise] Promise for pending request, if any
 * @return {boolean} Loading has been started
*/
ve.init.mw.ArticleTarget.prototype.load = function ( dataPromise ) {
	// Prevent duplicate requests
	if ( this.loading ) {
		return false;
	}
	this.events.trackActivationStart( mw.libs.ve.activationStart );
	mw.libs.ve.activationStart = null;

	this.loading = dataPromise || mw.libs.ve.targetLoader.requestPageData(
		this.getDefaultMode(),
		this.pageName,
		this.section,
		this.requestedRevId,
		this.constructor.name
	);
	this.loading
		.done( this.loadSuccess.bind( this ) )
		.fail( this.loadFail.bind( this ) );

	return true;
};

/**
 * Clear the state of this target, preparing it to be reactivated later.
 */
ve.init.mw.ArticleTarget.prototype.clearState = function () {
	this.clearPreparedCacheKey();
	this.loading = false;
	this.saving = false;
	this.diffing = false;
	this.serializing = false;
	this.submitting = false;
	this.baseTimeStamp = null;
	this.startTimeStamp = null;
	this.doc = null;
	this.originalHtml = null;
	this.section = null;
	this.editNotices = [];
	this.remoteNotices = [];
	this.localNoticeMessages = [];
};

/**
 * Switch to edit source mode
 *
 * @abstract
 * @method
 */
ve.init.mw.ArticleTarget.prototype.editSource = null;

/**
 * Get a document to save, cached until the surface is modified
 *
 * The default implementation returns an HTMLDocument, but other targets
 * may use a different document model (e.g. plain text for source mode).
 *
 * @return {Object} Document to save
 */
ve.init.mw.ArticleTarget.prototype.getDocToSave = function () {
	var surface;
	if ( !this.docToSave ) {
		this.docToSave = this.createDocToSave();
		// Cache clearing events
		surface = this.getSurface();
		surface.getModel().getDocument().once( 'transact', this.clearDocToSave.bind( this ) );
		surface.once( 'destroy', this.clearDocToSave.bind( this ) );
	}
	return this.docToSave;
};

/**
 * Create a document to save
 *
 * @return {Object} Document to save
 */
ve.init.mw.ArticleTarget.prototype.createDocToSave = function () {
	return this.getSurface().getDom();
};

/**
 * Clear the document to save from the cache
 */
ve.init.mw.ArticleTarget.prototype.clearDocToSave = function () {
	this.docToSave = null;
	this.clearPreparedCacheKey();
};

/**
 * Serialize the current document and store the result in the serialization cache on the server.
 *
 * This function returns a promise that is resolved once serialization is complete, with the
 * cache key passed as the first parameter.
 *
 * If there's already a request pending for the same (reference-identical) HTMLDocument, this
 * function will not initiate a new request but will return the promise for the pending request.
 * If a request for the same document has already been completed, this function will keep returning
 * the same promise (which will already have been resolved) until clearPreparedCacheKey() is called.
 *
 * @param {HTMLDocument} doc Document to serialize
 */
ve.init.mw.ArticleTarget.prototype.prepareCacheKey = function ( doc ) {
	var xhr, deflated,
		aborted = false,
		start = ve.now(),
		target = this;

	if ( this.getSurface().getMode() === 'source' ) {
		return;
	}

	if ( this.preparedCacheKeyPromise && this.preparedCacheKeyPromise.doc === doc ) {
		return this.preparedCacheKeyPromise;
	}
	this.clearPreparedCacheKey();

	this.preparedCacheKeyPromise = this.deflateHtml( doc )
		.then( function ( deflatedHtml ) {
			deflated = deflatedHtml;
			if ( aborted ) {
				return $.Deferred().reject();
			}
			xhr = new mw.Api().postWithToken( 'csrf',
				{
					action: 'visualeditoredit',
					paction: 'serializeforcache',
					html: deflatedHtml,
					page: target.pageName,
					oldid: target.revid,
					etag: target.etag
				},
				{ contentType: 'multipart/form-data' }
			);
			return xhr.then(
				function ( response ) {
					var trackData = { duration: ve.now() - start };
					if ( response.visualeditoredit && typeof response.visualeditoredit.cachekey === 'string' ) {
						target.events.track( 'performance.system.serializeforcache', trackData );
						return response.visualeditoredit.cachekey;
					} else {
						target.events.track( 'performance.system.serializeforcache.nocachekey', trackData );
						return $.Deferred().reject();
					}
				},
				function () {
					target.events.track( 'performance.system.serializeforcache.fail', { duration: ve.now() - start } );
				}
			);
		} )
		.promise( {
			abort: function () {
				if ( xhr ) {
					xhr.abort();
				}
				aborted = true;
			},
			getDeflatedHtml: function () {
				return deflated;
			},
			doc: doc
		} );
};

/**
 * Get the prepared wikitext, if any. Same as prepareWikitext() but does not initiate a request
 * if one isn't already pending or finished. Instead, it returns a rejected promise in that case.
 *
 * @param {HTMLDocument} doc Document to serialize
 * @return {jQuery.Promise} Abortable promise, resolved with the cache key.
 */
ve.init.mw.ArticleTarget.prototype.getPreparedCacheKey = function ( doc ) {
	var deferred;
	if ( this.preparedCacheKeyPromise && this.preparedCacheKeyPromise.doc === doc ) {
		return this.preparedCacheKeyPromise;
	}
	deferred = $.Deferred();
	deferred.reject();
	return deferred.promise();
};

/**
 * Clear the promise for the prepared wikitext cache key, and abort it if it's still in progress.
 */
ve.init.mw.ArticleTarget.prototype.clearPreparedCacheKey = function () {
	if ( this.preparedCacheKeyPromise ) {
		this.preparedCacheKeyPromise.abort();
		this.preparedCacheKeyPromise = null;
	}
};

/**
 * Try submitting an API request with a cache key for prepared wikitext, falling back to submitting
 * HTML directly if there is no cache key present or pending, or if the request for the cache key
 * fails, or if using the cache key fails with a badcachekey error.
 *
 * If options.token is set, this function will use mw.Api#post and let the caller handle badtoken
 * errors. If options.token is not set, this function will use mw.Api#postWithToken which retries
 * automatically when encountering a badtoken error. If you do not want the automatic retry behavior
 * and want to control badtoken retries, you have to set options.token.
 *
 * @param {HTMLDocument|string} doc Document to submit or string in source mode
 * @param {Object} options POST parameters to send. Do not include 'html', 'cachekey' or 'format'.
 * @param {string} [eventName] If set, log an event when the request completes successfully. The
 *  full event name used will be 'performance.system.{eventName}.withCacheKey' or .withoutCacheKey
 *  depending on whether or not a cache key was used.
 * @return {jQuery.Promise}
 */
ve.init.mw.ArticleTarget.prototype.tryWithPreparedCacheKey = function ( doc, options, eventName ) {
	var data, postData, preparedCacheKey,
		target = this;

	if ( this.getSurface().getMode() === 'source' ) {
		data = {
			wikitext: doc,
			format: 'json'
		};
		postData = ve.extendObject( {}, options, data );
		if ( this.section !== null ) {
			postData.section = this.section;
		}
		if ( this.sectionTitle ) {
			postData.sectiontitle = this.sectionTitle.getValue();
			postData.summary = undefined;
		}
		if ( postData.token ) {
			return new mw.Api().post( postData, { contentType: 'multipart/form-data' } );
		}
		return new mw.Api().postWithToken( 'csrf', postData, { contentType: 'multipart/form-data' } );
	}

	preparedCacheKey = this.getPreparedCacheKey( doc ),
	data = ve.extendObject( {}, options, { format: 'json' } );

	function ajaxRequest( cachekey, isRetried ) {
		var fullEventName,
			start = ve.now(),
			deflatePromise = $.Deferred().resolve().promise();

		if ( typeof cachekey === 'string' ) {
			data.cachekey = cachekey;
		} else {
			// Getting a cache key failed, fall back to sending the HTML
			data.html = preparedCacheKey && preparedCacheKey.getDeflatedHtml && preparedCacheKey.getDeflatedHtml();
			if ( !data.html ) {
				deflatePromise = target.deflateHtml( doc ).then( function ( deflatedHtml ) {
					data.html = deflatedHtml;
				} );
			}
			// If using the cache key fails, we'll come back here with cachekey still set
			delete data.cachekey;
		}
		return deflatePromise
			.then( function () {
				if ( data.token ) {
					return new mw.Api().post( data, { contentType: 'multipart/form-data' } );
				}
				return new mw.Api().postWithToken( 'csrf', data, { contentType: 'multipart/form-data' } );
			} )
			.then(
				function ( response, jqxhr ) {
					var eventData = {
						bytes: $.byteLength( jqxhr.responseText ),
						duration: ve.now() - start
					};

					// Log data about the request if eventName was set
					if ( eventName ) {
						fullEventName = 'performance.system.' + eventName +
							( typeof cachekey === 'string' ? '.withCacheKey' : '.withoutCacheKey' );
						target.events.track( fullEventName, eventData );
					}
					return jqxhr;
				},
				function ( errorName, errorObject ) {
					var responseText = ve.getProp( errorObject, 'xhr', 'responseText' ),
						eventData;
					if ( responseText ) {
						eventData = {
							bytes: $.byteLength( responseText ),
							duration: ve.now() - start
						};

						if ( eventName ) {
							if ( errorName === 'badcachekey' ) {
								fullEventName = 'performance.system.' + eventName + '.badCacheKey';
							} else {
								fullEventName = 'performance.system.' + eventName + '.withoutCacheKey';
							}
							target.events.track( fullEventName, eventData );
						}
					}
					// This cache key is evidently bad, clear it
					target.clearPreparedCacheKey();
					if ( !isRetried && errorName === 'badcachekey' ) {
						// Try again without a cache key
						return ajaxRequest( null, true );
					} else {
						// Failed twice in a row, must be some other error - let caller handle it.
						// FIXME Can't just `return this` because all callers are broken.
						return $.Deferred().reject( null, errorName, errorObject ).promise();
					}
				}
			);
	}

	// If we successfully get prepared wikitext, then invoke ajaxRequest() with the cache key,
	// otherwise invoke it without.
	return preparedCacheKey.then( ajaxRequest, ajaxRequest );
};

/**
 * Handle the save dialog's save event
 *
 * Validates the inputs then starts the save process
 *
 * @param {jQuery.Deferred} saveDeferred Deferred object to resolve/reject when the save
 *  succeeds/fails.
 * @fires saveInitiated
 */
ve.init.mw.ArticleTarget.prototype.onSaveDialogSave = function ( saveDeferred ) {
	var saveOptions;

	if ( this.deactivating ) {
		return;
	}

	saveOptions = this.getSaveOptions();

	// Reset any old captcha data
	if ( this.captcha ) {
		this.saveDialog.clearMessage( 'captcha' );
		delete this.captcha;
	}

	if (
		+mw.user.options.get( 'forceeditsummary' ) &&
		( saveOptions.summary === '' || saveOptions.summary === this.initialEditSummary ) &&
		!this.saveDialog.messages.missingsummary
	) {
		this.saveDialog.showMessage(
			'missingsummary',
			// Wrap manually since this core message already includes a bold "Warning:" label
			$( '<p>' ).append( ve.init.platform.getParsedMessage( 'missingsummary' ) ),
			{ wrap: false }
		);
		this.saveDialog.popPending();
	} else {
		this.emit( 'saveInitiated' );
		this.startSave( saveOptions );
		this.saveDeferred = saveDeferred;
	}
};

/**
 * Start the save process
 *
 * @param {Object} saveOptions Save options
 */
ve.init.mw.ArticleTarget.prototype.startSave = function ( saveOptions ) {
	this.save( this.getDocToSave(), saveOptions );
};

/**
 * Get save form fields from the save dialog form.
 *
 * @return {Object} Form data for submission to the MediaWiki action=edit UI
 */
ve.init.mw.ArticleTarget.prototype.getSaveFields = function () {
	var name,
		fields = {
			wpSummary: this.saveDialog ? this.saveDialog.editSummaryInput.getValue() : this.initialEditSummary,
			wpCaptchaId: this.captcha && this.captcha.id,
			wpCaptchaWord: this.captcha && this.captcha.input.getValue()
		};
	if ( this.recreating ) {
		fields.wpRecreate = true;
	}

	for ( name in this.checkboxesByName ) {
		if ( this.checkboxesByName[ name ].isSelected() ) {
			fields[ name ] = this.checkboxesByName[ name ].getValue();
		}
	}
	this.$otherFields.each( function () {
		var $this = $( this ),
			name = $this.prop( 'name' );
		if ( name ) {
			fields[ name ] = $this.val();
		}
	} );

	return fields;
};

/**
 * Invoke #submit with the data from #getSaveFields
 *
 * @param {Object} fields Fields to add in addition to those from #getSaveFields
 * @param {string} wikitext Wikitext to submit
 * @return {boolean} Whether submission was started
 */
ve.init.mw.ArticleTarget.prototype.submitWithSaveFields = function ( fields, wikitext ) {
	return this.submit( wikitext, $.extend( this.getSaveFields(), fields ) );
};

/**
 * Get edit API options from the save dialog form.
 *
 * @return {Object} Save options for submission to the MediaWiki API
 */
ve.init.mw.ArticleTarget.prototype.getSaveOptions = function () {
	var key,
		options = this.getSaveFields(),
		fieldMap = {
			wpSummary: 'summary',
			wpMinoredit: 'minor',
			wpWatchthis: 'watch',
			wpCaptchaId: 'captchaid',
			wpCaptchaWord: 'captchaword'
		};

	for ( key in fieldMap ) {
		if ( options[ key ] !== undefined ) {
			options[ fieldMap[ key ] ] = options[ key ];
			delete options[ key ];
		}
	}

	return options;
};

/**
 * Post DOM data to the Parsoid API.
 *
 * This method performs an asynchronous action and uses a callback function to handle the result.
 *
 *     target.save( dom, { summary: 'test', minor: true, watch: false } );
 *
 * @method
 * @param {HTMLDocument} doc Document to save
 * @param {Object} options Saving options. All keys are passed through, including unrecognized ones.
 *  - {string} summary Edit summary
 *  - {boolean} minor Edit is a minor edit
 *  - {boolean} watch Watch the page
 * @return {boolean} Saving has been started
*/
ve.init.mw.ArticleTarget.prototype.save = function ( doc, options ) {
	var data;
	// Prevent duplicate requests
	if ( this.saving ) {
		return false;
	}

	data = ve.extendObject( {}, options, {
		action: 'visualeditoredit',
		paction: 'save',
		page: this.pageName,
		oldid: this.revid,
		basetimestamp: this.baseTimeStamp,
		starttimestamp: this.startTimeStamp,
		etag: this.etag,
		// Pass in token to prevent automatic badtoken retries
		token: this.editToken
	} );

	this.saving = this.tryWithPreparedCacheKey( doc, data, 'save' )
		.done( this.saveSuccess.bind( this, doc, data ) )
		.fail( this.saveFail.bind( this, doc, data ) );

	return true;
};

/**
 * Post DOM data to the Parsoid API to retrieve wikitext diff.
 *
 * @method
 * @param {HTMLDocument} doc Document to compare against (via wikitext)
 * @return {boolean} Diffing has been started
*/
ve.init.mw.ArticleTarget.prototype.showChanges = function ( doc ) {
	if ( this.diffing ) {
		return false;
	}
	this.diffing = this.tryWithPreparedCacheKey( doc, {
		action: 'visualeditoredit',
		paction: 'diff',
		page: this.pageName,
		oldid: this.revid,
		etag: this.etag
	}, 'diff' )
		.done( this.showChangesSuccess.bind( this ) )
		.fail( this.showChangesFail.bind( this ) );

	return true;
};

/**
 * Post wikitext to MediaWiki.
 *
 * This method performs a synchronous action and will take the user to a new page when complete.
 *
 *     target.submit( wikitext, { wpSummary: 'test', wpMinorEdit: 1, wpSave: 1 } );
 *
 * @method
 * @param {string} wikitext Wikitext to submit
 * @param {Object} fields Other form fields to add (e.g. wpSummary, wpWatchthis, etc.). To actually
 *  save the wikitext, add { wpSave: 1 }. To go to the diff view, add { wpDiff: 1 }.
 * @return {boolean} Submitting has been started
*/
ve.init.mw.ArticleTarget.prototype.submit = function ( wikitext, fields ) {
	var key, $form, params;

	// Prevent duplicate requests
	if ( this.submitting ) {
		return false;
	}
	// Save DOM
	this.submitting = true;
	$form = $( '<form method="post" enctype="multipart/form-data" style="display: none;"></form>' );
	params = ve.extendObject( {
		format: 'text/x-wiki',
		model: 'wikitext',
		oldid: this.requestedRevId,
		wpStarttime: this.startTimeStamp,
		wpEdittime: this.baseTimeStamp,
		wpTextbox1: wikitext,
		wpEditToken: this.editToken
	}, fields );
	// Add params as hidden fields
	for ( key in params ) {
		$form.append( $( '<input>' ).attr( { type: 'hidden', name: key, value: params[ key ] } ) );
	}
	// Submit the form, mimicking a traditional edit
	// Firefox requires the form to be attached
	$form.attr( 'action', this.submitUrl ).appendTo( 'body' ).submit();
	return true;
};

/**
 * Get Wikitext data from the Parsoid API.
 *
 * This method performs an asynchronous action and uses a callback function to handle the result.
 *
 *     target.serialize(
 *         dom,
 *         function ( wikitext ) {
 *             // Do something with the loaded DOM
 *         }
 *     );
 *
 * @method
 * @param {HTMLDocument} doc Document to serialize
 * @param {Function} callback Function to call when complete, accepts error and wikitext arguments
 * @return {boolean} Serializing has been started
*/
ve.init.mw.ArticleTarget.prototype.serialize = function ( doc, callback ) {
	// Prevent duplicate requests
	if ( this.serializing ) {
		return false;
	}
	this.serializeCallback = callback;
	this.serializing = this.tryWithPreparedCacheKey( doc, {
		action: 'visualeditoredit',
		paction: 'serialize',
		page: this.pageName,
		oldid: this.revid,
		etag: this.etag
	}, 'serialize' )
		.done( this.serializeSuccess.bind( this ) )
		.fail( this.serializeFail.bind( this ) );
	return true;
};

/**
 * Get list of edit notices.
 *
 * @return {Array} List of edit notices
 */
ve.init.mw.ArticleTarget.prototype.getEditNotices = function () {
	return this.editNotices;
};

// FIXME: split out view specific functionality, emit to subclass

/**
 * @inheritdoc
 */
ve.init.mw.ArticleTarget.prototype.track = function ( name ) {
	ve.track( name );
};

/**
 * @inheritdoc
 */
ve.init.mw.ArticleTarget.prototype.createSurface = function () {
	// Parent method
	var surface = ve.init.mw.ArticleTarget.super.prototype.createSurface.apply( this, arguments );

	surface.$element.addClass( this.protectedClasses );

	return surface;
};

/**
 * @inheritdoc
 */
ve.init.mw.ArticleTarget.prototype.setupToolbar = function () {
	// Parent method
	ve.init.mw.ArticleTarget.super.prototype.setupToolbar.apply( this, arguments );

	this.setupToolbarSaveButton();
	this.attachToolbarSaveButton();

	if ( this.saveDialog ) {
		this.initialEditSummary = this.saveDialog.editSummaryInput.getValue();
		this.saveDialog.disconnect( this );
		this.saveDialog = null;
	}
};

/**
 * Getting the message for the toolbar / save dialog save / publish button
 *
 * @return {Function|string} An i18n message or resolveable function
 */
ve.init.mw.ArticleTarget.prototype.getSaveButtonLabel = function () {
	if ( mw.config.get( 'wgEditSubmitButtonLabelPublish' ) ) {
		return OO.ui.deferMsg( !this.pageExists ? 'publishpage' : 'publishchanges' );
	}

	return OO.ui.deferMsg( !this.pageExists ? 'savearticle' : 'savechanges' );
};

/**
 * Add content and event bindings to toolbar save button.
 *
 * @param {Object} [config] Configuration options for the button
 */
ve.init.mw.ArticleTarget.prototype.setupToolbarSaveButton = function ( config ) {
	if ( !this.toolbarSaveButton ) {
		this.toolbarSaveButton = new OO.ui.ButtonWidget( ve.extendObject( {
			label: this.getSaveButtonLabel(),
			flags: [ 'progressive', 'primary' ],
			disabled: !this.restoring
		}, config ) );

		// NOTE (phuedx, 2014-08-20): This class is used by the firsteditve guided
		// tour to attach a guider to the "Save page" button.
		this.toolbarSaveButton.$element.addClass( 've-ui-toolbar-saveButton' );

		if ( ve.msg( 'accesskey-save' ) !== '-' && ve.msg( 'accesskey-save' ) !== '' ) {
			// FlaggedRevs tries to use this - it's useless on VE pages because all that stuff gets hidden, but it will still conflict so get rid of it
			this.elementsThatHadOurAccessKey = $( '[accesskey="' + ve.msg( 'accesskey-save' ) + '"]' ).removeAttr( 'accesskey' );
			this.toolbarSaveButton.$button.attr( 'accesskey', ve.msg( 'accesskey-save' ) );
		}

		this.toolbarSaveButton.connect( this, { click: 'onToolbarSaveButtonClick' } );
	}
	this.updateToolbarSaveButtonState();
};

/**
 * Add the save button to the user interface.
 */
ve.init.mw.ArticleTarget.prototype.attachToolbarSaveButton = function () {
	this.toolbar.$actions.append( this.toolbarSaveButton.$element );
};

/**
 * Re-evaluate whether the toolbar save button should be disabled or not.
 */
ve.init.mw.ArticleTarget.prototype.updateToolbarSaveButtonState = function () {
	var isDisabled;

	this.edited = this.getSurface().getModel().hasBeenModified() || this.fromEditedState;
	if ( this.sectionTitle ) {
		this.edited = this.edited || this.sectionTitle.getValue() !== '';
	}
	// Disable the save button if we have no history
	isDisabled = !this.edited && !this.restoring;
	this.toolbarSaveButton.setDisabled( isDisabled );
	mw.hook( 've.toolbarSaveButton.stateChanged' ).fire( isDisabled );
};

/**
 * Handle clicks on the save button in the toolbar.
 */
ve.init.mw.ArticleTarget.prototype.onToolbarSaveButtonClick = function () {
	this.showSaveDialog();
};

/**
 * Show a save dialog
 *
 * @param {string} [action] Window action to trigger after opening
 * @param {string} [initialPanel] Initial panel to show in the dialog
 *
 * @fires saveWorkflowBegin
 */
ve.init.mw.ArticleTarget.prototype.showSaveDialog = function ( action, initialPanel ) {
	var target = this,
		windowAction = ve.ui.actionFactory.create( 'window', this.getSurface() );

	if ( !( this.edited || this.restoring ) ) {
		return;
	}

	this.emit( 'saveWorkflowBegin' );

	// Preload the serialization
	this.prepareCacheKey( this.getDocToSave() );

	// Connect events to save dialog
	this.getSurface().getDialogs().getWindow( 'mwSave' ).done( function ( win ) {
		if ( !target.saveDialog ) {
			target.saveDialog = win;

			// Connect to save dialog
			target.saveDialog.connect( target, {
				save: 'onSaveDialogSave',
				review: 'onSaveDialogReview',
				preview: 'onSaveDialogPreview',
				resolve: 'onSaveDialogResolveConflict',
				retry: 'onSaveDialogRetry',
				close: 'onSaveDialogClose'
			} );
		}
	} );

	// Open the dialog
	windowAction.open( 'mwSave', this.getSaveDialogOpeningData( initialPanel ), action );
};

/**
 * Get opening data to pass to the save dialog
 *
 * @param {string} [initialPanel] Initial panel to show in the dialog
 */
ve.init.mw.ArticleTarget.prototype.getSaveDialogOpeningData = function ( initialPanel ) {
	return {
		saveButtonLabel: this.getSaveButtonLabel(),
		checkboxFields: this.checkboxFields,
		checkboxesByName: this.checkboxesByName,
		initialPanel: initialPanel
	};
};

/**
 * Move the cursor in the editor to section specified by this.section.
 * Do nothing if this.section is undefined.
 *
 * @method
 */
ve.init.mw.ArticleTarget.prototype.restoreEditSection = function () {
	var headingText,
		surface = this.getSurface(),
		mode = surface.getMode(),
		surfaceView, $documentNode, $section, headingNode;

	if ( this.section !== null && this.section !== 'new' && this.section !== 0 ) {
		if ( mode === 'visual' ) {
			surfaceView = surface.getView();
			$documentNode = surfaceView.getDocument().getDocumentNode().$element;
			$section = $documentNode.find( 'h1, h2, h3, h4, h5, h6' ).eq( this.section - 1 );
			headingNode = $section.data( 'view' );

			if ( $section.length && new mw.Uri().query.summary === undefined ) {
				headingText = $section.text();
			}

			if ( headingNode ) {
				this.goToHeading( headingNode );
			}
		} else if ( mode === 'source' ) {
			headingText = surface.getModel().getDocument().data.getText(
				false,
				surface.getModel().getDocument().getDocumentNode().children[ 0 ].getRange()
			).replace( /^\s*=+\s*(.*?)\s*=+\s*$/, '$1' );
		}
		if ( headingText ) {
			this.initialEditSummary =
				'/* ' +
				ve.graphemeSafeSubstring( headingText, 0, 244 ) +
				' */ ';
		}
	}
};

/**
 * Move the cursor to a given heading and scroll to it.
 *
 * @method
 * @param {ve.ce.HeadingNode} headingNode Heading node to scroll to
 */
ve.init.mw.ArticleTarget.prototype.goToHeading = function ( headingNode ) {
	var nextNode, offset,
		target = this,
		offsetNode = headingNode,
		surface = this.getSurface(),
		surfaceModel = surface.getModel(),
		surfaceView = surface.getView(),
		lastHeadingLevel = -1;

	// Find next sibling which isn't a heading
	while ( offsetNode instanceof ve.ce.HeadingNode && offsetNode.getModel().getAttribute( 'level' ) > lastHeadingLevel ) {
		lastHeadingLevel = offsetNode.getModel().getAttribute( 'level' );
		// Next sibling
		nextNode = offsetNode.parent.children[ offsetNode.parent.children.indexOf( offsetNode ) + 1 ];
		if ( !nextNode ) {
			break;
		}
		offsetNode = nextNode;
	}
	offset = surfaceModel.getDocument().data.getNearestContentOffset(
		offsetNode.getModel().getOffset(), 1
	);

	function scrollAndSetSelection() {
		surfaceModel.setLinearSelection( new ve.Range( offset ) );
		// Focussing the document triggers showSelection which calls scrollIntoView
		// which uses a jQuery animation, so make sure this is aborted.
		$( OO.ui.Element.static.getClosestScrollableContainer( surfaceView.$element[ 0 ] ) ).stop( true );
		target.scrollToHeading( headingNode );
	}

	if ( surfaceView.isFocused() ) {
		scrollAndSetSelection();
	} else {
		// onDocumentFocus is debounced, so wait for that to happen before setting
		// the model selection, otherwise it will get reset
		surfaceView.once( 'focus', scrollAndSetSelection );
	}
};

/**
 * Scroll to a given heading in the document.
 *
 * @method
 * @param {ve.ce.HeadingNode} headingNode Heading node to scroll to
 */
ve.init.mw.ArticleTarget.prototype.scrollToHeading = function ( headingNode ) {
	var $window = $( OO.ui.Element.static.getWindow( this.$element ) );

	$window.scrollTop( headingNode.$element.offset().top - this.getToolbar().$element.height() );
};

/**
 * Show the beta dialog as needed
 */
ve.init.mw.ArticleTarget.prototype.maybeShowWelcomeDialog = function () {
	var usePrefs, prefSaysShow, urlSaysHide,
		windowManager = this.getSurface().dialogs,
		target = this;

	this.welcomeDialogPromise = $.Deferred();

	if ( mw.config.get( 'wgVisualEditorConfig' ).showBetaWelcome ) {
		// Only use the preference value if the user is logged-in.
		// If the user is anonymous, we can't save the preference
		// after showing the dialog. And we don't intend to use this
		// preference to influence anonymous users (use the config
		// variable for that; besides the pref value would be stale if
		// the wiki uses static html caching).
		usePrefs = !mw.user.isAnon();
		prefSaysShow = usePrefs && !mw.user.options.get( 'visualeditor-hidebetawelcome' );
		urlSaysHide = 'vehidebetadialog' in new mw.Uri( location.href ).query;

		if (
			!urlSaysHide &&
			(
				prefSaysShow ||
				(
					!usePrefs &&
					localStorage.getItem( 've-beta-welcome-dialog' ) === null &&
					$.cookie( 've-beta-welcome-dialog' ) === null
				)
			)
		) {
			this.welcomeDialog = new mw.libs.ve.WelcomeDialog();
			windowManager.addWindows( [ this.welcomeDialog ] );
			windowManager.openWindow(
				this.welcomeDialog,
				{
					switchable: this.constructor.static.trackingName !== 'mobile',
					editor: this.getDefaultMode()
				}
			)
				.then( function ( opened ) {
					return opened;
				} )
				.then( function ( closing ) {
					return closing;
				} )
				.then( function ( data ) {
					target.welcomeDialogPromise.resolve();
					target.welcomeDialog = null;
					// switchToWikitextEditor and switchToVisualEditor are actually
					// only defined in subclasses :/
					if ( data && data.action === 'switch-wte' ) {
						// TODO: Make this work on mobile - right now we can only
						// get away with it because the button which triggers this
						// action is hidden on mobile
						target.switchToWikitextEditor( true, true );
					} else if ( data && data.action === 'switch-ve' ) {
						target.switchToVisualEditor();
					}
				} );
		} else {
			this.welcomeDialogPromise.resolve();
		}

		if ( prefSaysShow ) {
			new mw.Api().saveOption( 'visualeditor-hidebetawelcome', '1' );

			// No need to set a cookie every time for logged-in users that have already
			// set the hidebetawelcome=1 preference, but only if this isn't a one-off
			// view of the page via the hiding GET parameter.
		} else if ( !usePrefs && !urlSaysHide ) {
			try {
				localStorage.setItem( 've-beta-welcome-dialog', 1 );
			} catch ( e ) {
				$.cookie( 've-beta-welcome-dialog', 1, { path: '/', expires: 30 } );
			}
		}
	} else {
		this.welcomeDialogPromise.reject();
	}
};
