/*!
 * VisualEditor UserInterface MWSaveDialog class.
 *
 * @copyright 2011-2017 VisualEditor Team and others; see AUTHORS.txt
 * @license The MIT License (MIT); see LICENSE.txt
 */

/**
 * Dialog for saving MediaWiki pages.
 *
 * Note that most methods are not safe to call before the dialog has initialized, except where
 * noted otherwise.
 *
 * @class
 * @extends OO.ui.ProcessDialog
 *
 * @constructor
 * @param {Object} [config] Config options
 */
ve.ui.MWSaveDialog = function VeUiMwSaveDialog( config ) {
	// Parent constructor
	ve.ui.MWSaveDialog.super.call( this, config );

	// Properties
	this.editSummaryByteLimit = 255;
	this.restoring = false;
	this.messages = {};
	this.setupDeferred = $.Deferred();
	this.checkboxesByName = null;
	this.changedEditSummary = false;
	this.canReview = false;
	this.canPreview = false;

	// Initialization
	this.$element.addClass( 've-ui-mwSaveDialog' );
};

/* Inheritance */

OO.inheritClass( ve.ui.MWSaveDialog, OO.ui.ProcessDialog );

/* Static Properties */

ve.ui.MWSaveDialog.static.name = 'mwSave';

ve.ui.MWSaveDialog.static.title =
	OO.ui.deferMsg( 'visualeditor-savedialog-title-save' );

ve.ui.MWSaveDialog.static.actions = [
	{
		action: 'save',
		// May be overridden by config.saveButtonLabel
		label: OO.ui.deferMsg( 'visualeditor-savedialog-label-review' ),
		flags: [ 'primary', 'constructive' ],
		modes: [ 'save', 'review', 'preview' ],
		accessKey: 's'
	},
	{
		label: OO.ui.deferMsg( 'visualeditor-savedialog-label-resume-editing' ),
		flags: [ 'safe', 'back' ],
		modes: [ 'save', 'review', 'preview', 'conflict' ]
	},
	{
		action: 'review',
		label: OO.ui.deferMsg( 'visualeditor-savedialog-label-review' ),
		modes: [ 'save', 'preview' ]
	},
	{
		action: 'preview',
		label: OO.ui.deferMsg( 'showpreview' ),
		modes: [ 'save', 'review' ]
	},
	{
		action: 'approve',
		label: OO.ui.deferMsg( 'visualeditor-savedialog-label-review-good' ),
		modes: [ 'review', 'preview' ]
	},
	{
		action: 'resolve',
		label: OO.ui.deferMsg( 'visualeditor-savedialog-label-resolve-conflict' ),
		flags: [ 'primary', 'constructive' ],
		modes: 'conflict'
	}
];

/* Events */

/**
 * @event save
 * @param {jQuery.Deferred} saveDeferred Deferred object to resolve/reject when the save
 *  succeeds/fails.
 * Emitted when the user clicks the save button
 */

/**
 * @event review
 * Emitted when the user clicks the review changes button
 */

/**
 * @event preview
 * Emitted when the user clicks the show preview button
 */

/**
 * @event resolve
 * Emitted when the user clicks the resolve conflict button
 */

/**
 * @event retry
 * Emitted when the user clicks the retry/continue save button after an error.
 */

/* Methods */

/**
 * Set review content and show review panel.
 *
 * @param {string} content Diff HTML or wikitext
 */
ve.ui.MWSaveDialog.prototype.setDiffAndReview = function ( content ) {
	this.$reviewViewer.empty().append( content );
	this.actions.setAbilities( { approve: true } );
	this.popPending();
	this.swapPanel( 'review' );
};

/**
 * Set preview content and show preview panel.
 *
 * @param {jQuery} content Preview content
 */
ve.ui.MWSaveDialog.prototype.showPreview = function ( content ) {
	this.$previewViewer.empty().append( content );
	mw.hook( 'wikipage.content' ).fire( this.$previewViewer );
	this.actions.setAbilities( { approve: true } );
	this.popPending();
	this.swapPanel( 'preview' );
};

/**
 * @inheritdoc
 */
ve.ui.MWSaveDialog.prototype.pushPending = function () {
	this.getActions().setAbilities( { review: false, preview: false } );
	return ve.ui.MWSaveDialog.super.prototype.pushPending.call( this );
};

/**
 * @inheritdoc
 */
ve.ui.MWSaveDialog.prototype.popPending = function () {
	var ret = ve.ui.MWSaveDialog.super.prototype.popPending.call( this );
	if ( !this.isPending() ) {
		this.getActions().setAbilities( { review: true, preview: true } );
	}
	return ret;
};

/**
 * Clear the diff displayed in the review panel, if any.
 */
ve.ui.MWSaveDialog.prototype.clearDiff = function () {
	this.$reviewViewer.empty();
	this.$previewViewer.empty();
};

/**
 * Swap state in the save dialog.
 *
 * @param {string} panel One of 'save', 'review', 'conflict' or 'nochanges'
 * @param {boolean} [noFocus] Don't attempt to focus anything (e.g. while setting up)
 * @return {jQuery} The now active panel
 * @throws {Error} Unknown saveDialog panel
 */
ve.ui.MWSaveDialog.prototype.swapPanel = function ( panel, noFocus ) {
	var currentEditSummaryWikitext,
		mode = panel,
		size = 'medium',
		dialog = this,
		panelObj = dialog[ panel + 'Panel' ];

	if ( ( [ 'save', 'review', 'preview', 'conflict', 'nochanges' ].indexOf( panel ) ) === -1 ) {
		throw new Error( 'Unknown saveDialog panel: ' + panel );
	}

	// Update the window title
	// The following messages can be used here:
	// visualeditor-savedialog-title-conflict
	// visualeditor-savedialog-title-nochanges
	// visualeditor-savedialog-title-preview
	// visualeditor-savedialog-title-review
	// visualeditor-savedialog-title-save
	this.title.setLabel( ve.msg( 'visualeditor-savedialog-title-' + panel ) );

	// Reset save button if we disabled it for e.g. unrecoverable spam error
	this.actions.setAbilities( { save: true } );

	if ( !noFocus ) {
		// On panels without inputs, ensure the dialog is focused so events
		// are captured, e.g. 'Esc' to close
		this.$content[ 0 ].focus();
	}

	switch ( panel ) {
		case 'save':
			if ( !noFocus ) {
				// HACK: FF needs *another* defer
				setTimeout( function () {
					dialog.editSummaryInput.moveCursorToEnd();
				} );
			}
			break;
		case 'conflict':
			this.actions.setAbilities( { save: false } );
			break;
		case 'preview':
			size = 'full';
			this.previewPanel.$element[ 0 ].focus();
			break;
		case 'review':
			size = 'larger';
			currentEditSummaryWikitext = this.editSummaryInput.getValue();
			if ( this.lastEditSummaryWikitext === undefined || this.lastEditSummaryWikitext !== currentEditSummaryWikitext ) {
				if ( this.editSummaryXhr ) {
					this.editSummaryXhr.abort();
				}
				this.lastEditSummaryWikitext = currentEditSummaryWikitext;
				this.$reviewEditSummary.empty();

				if ( !currentEditSummaryWikitext || currentEditSummaryWikitext.trim() === '' ) {
					// Don't bother with an API request for an empty summary
					this.$reviewEditSummary.parent().addClass( 'oo-ui-element-hidden' );
				} else {
					this.$reviewEditSummary.parent()
						.removeClass( 'oo-ui-element-hidden' )
						.addClass( 'mw-ajax-loader' );
					this.editSummaryXhr = new mw.Api().post( {
						action: 'parse',
						summary: currentEditSummaryWikitext
					} ).done( function ( result ) {
						if ( result.parse.parsedsummary[ '*' ] === '' ) {
							dialog.$reviewEditSummary.parent().addClass( 'oo-ui-element-hidden' );
						} else {
							// Intentionally treated as HTML
							dialog.$reviewEditSummary.html( ve.msg( 'parentheses', result.parse.parsedsummary[ '*' ] ) );
						}
					} ).fail( function () {
						dialog.$reviewEditSummary.parent().addClass( 'oo-ui-element-hidden' );
					} ).always( function () {
						dialog.$reviewEditSummary.parent().removeClass( 'mw-ajax-loader' );
						dialog.updateSize();
					} );
				}
			}
			break;
		case 'nochanges':
			mode = 'review';
			break;
	}

	// Show the target panel
	this.panels.setItem( panelObj );
	this.setSize( size );

	// Set mode after setting size so that the footer is measured correctly
	this.actions.setMode( mode );

	// Only show preview in source mode
	this.actions.forEach( { actions: 'preview' }, function ( action ) {
		action.toggle( dialog.canPreview );
	} );

	// Diff API doesn't support section=new
	this.actions.forEach( { actions: 'review' }, function ( action ) {
		action.toggle( dialog.canReview );
	} );

	mw.hook( 've.saveDialog.stateChanged' ).fire();

	return dialog;
};

/**
 * Show a message in the save dialog.
 *
 * @param {string} name Message's unique name
 * @param {string|jQuery|Array} message Message content (string of HTML, jQuery object or array of
 *  Node objects)
 * @param {Object} [options]
 * @param {boolean} [options.wrap="warning"] Whether to wrap the message in a paragraph and if
 *  so, how. One of "warning", "error" or false.
 */
ve.ui.MWSaveDialog.prototype.showMessage = function ( name, message, options ) {
	var $message;
	if ( !this.messages[ name ] ) {
		options = options || {};
		if ( options.wrap === undefined ) {
			options.wrap = 'warning';
		}
		$message = $( '<div class="ve-ui-mwSaveDialog-message"></div>' );
		if ( options.wrap !== false ) {
			$message.append( $( '<p>' ).append(
				// visualeditor-savedialog-label-error
				// visualeditor-savedialog-label-warning
				$( '<strong>' ).text( mw.msg( 'visualeditor-savedialog-label-' + options.wrap ) ),
				document.createTextNode( mw.msg( 'colon-separator' ) ),
				message
			) );
		} else {
			$message.append( message );
		}
		this.$saveMessages.append( $message );

		$message.slideDown( {
			progress: this.updateSize.bind( this )
		} );

		this.messages[ name ] = $message;
	}
};

/**
 * Remove a message from the save dialog.
 *
 * @param {string} name Message's unique name
 */
ve.ui.MWSaveDialog.prototype.clearMessage = function ( name ) {
	if ( this.messages[ name ] ) {
		this.messages[ name ].slideUp( {
			progress: this.updateSize.bind( this )
		} );
		delete this.messages[ name ];
	}
};

/**
 * Remove all messages from the save dialog.
 */
ve.ui.MWSaveDialog.prototype.clearAllMessages = function () {
	this.$saveMessages.empty();
	this.messages = {};
};

/**
 * Reset the fields of the save dialog.
 *
 * @method
 */
ve.ui.MWSaveDialog.prototype.reset = function () {
	// Reset summary input
	this.editSummaryInput.setValue( '' );
	// Uncheck minoredit
	if ( this.checkboxesByName.wpMinoredit ) {
		this.checkboxesByName.wpMinoredit.setSelected( false );
	}
	this.clearDiff();
};

/**
 * Initialize MediaWiki page specific checkboxes.
 *
 * This method is safe to call even when the dialog hasn't been initialized yet.
 *
 * @param {OO.ui.FieldLayout[]} checkboxFields Checkbox fields
 */
ve.ui.MWSaveDialog.prototype.setupCheckboxes = function ( checkboxFields ) {
	var dialog = this;
	this.setupDeferred.done( function () {
		checkboxFields.forEach( function ( field ) {
			dialog.$saveCheckboxes.append( field.$element );
		} );
	} );
};

/**
 * Change the edit summary prefilled in the save dialog.
 *
 * This method is safe to call even when the dialog hasn't been initialized yet.
 *
 * @param {string} summary Edit summary to prefill
 */
ve.ui.MWSaveDialog.prototype.setEditSummary = function ( summary ) {
	var dialog = this;
	this.setupDeferred.done( function () {
		dialog.editSummaryInput.setValue( summary );
	} );
};

/**
 * @inheritdoc
 */
ve.ui.MWSaveDialog.prototype.initialize = function () {
	var saveAccessKey,
		dialog = this;

	// Parent method
	ve.ui.MWSaveDialog.super.prototype.initialize.call( this );

	// Properties
	this.panels = new OO.ui.StackLayout( { scrollable: true } );
	this.savePanel = new OO.ui.PanelLayout( {
		expanded: false,
		scrollable: true,
		padded: true,
		classes: [ 've-ui-mwSaveDialog-savePanel' ]
	} );

	// Byte counter in edit summary
	this.editSummaryCountLabel = new OO.ui.LabelWidget( {
		classes: [ 've-ui-mwSaveDialog-editSummary-count' ],
		label: String( this.editSummaryByteLimit ),
		title: ve.msg( 'visualeditor-editsummary-bytes-remaining' )
	} );

	// Save panel
	this.$editSummaryLabel = $( '<div>' ).addClass( 've-ui-mwSaveDialog-summaryLabel' )
		.html( ve.init.platform.getParsedMessage( 'summary' ) )
		.find( 'a' ).attr( 'target', '_blank' ).end();
	this.editSummaryInput = new OO.ui.TextInputWidget( {
		multiline: true,
		placeholder: ve.msg( 'visualeditor-editsummary' ),
		classes: [ 've-ui-mwSaveDialog-summary' ],
		inputFilter: function ( value ) {
			// Prevent the user from inputting newlines (this kicks in on paste, etc.)
			return value.replace( /\r?\n/g, ' ' );
		}
	} );
	// Prevent the user from inputting newlines from keyboard
	this.editSummaryInput.$input.on( 'keypress', function ( e ) {
		if ( e.which === OO.ui.Keys.ENTER ) {
			e.preventDefault();
		}
	} );
	// Limit byte length, and display the remaining bytes
	this.editSummaryInput.$input.byteLimit( this.editSummaryByteLimit );
	this.editSummaryInput.on( 'change', function () {
		dialog.changedEditSummary = true;
		// TODO: This looks a bit weird, there is no unit in the UI, just numbers
		// Users likely assume characters but then it seems to count down quicker
		// than expected. Facing users with the word "byte" is bad? (bug 40035)
		dialog.editSummaryCountLabel.setLabel(
			String( dialog.editSummaryByteLimit - $.byteLength( dialog.editSummaryInput.getValue() ) )
		);
	} );

	this.$saveCheckboxes = $( '<div>' ).addClass( 've-ui-mwSaveDialog-checkboxes' );
	this.$saveOptions = $( '<div>' ).addClass( 've-ui-mwSaveDialog-options' ).append(
		this.$saveCheckboxes,
		this.editSummaryCountLabel.$element
	);
	this.$saveMessages = $( '<div>' ).addClass( 've-ui-mwSaveDialog-messages' );
	this.$saveFoot = $( '<div>' ).addClass( 've-ui-mwSaveDialog-foot' ).append(
		$( '<p>' ).addClass( 've-ui-mwSaveDialog-license' )
			.html( ve.init.platform.getParsedMessage( 'copyrightwarning' ) )
			.find( 'a' ).attr( 'target', '_blank' ).end()
	);
	this.savePanel.$element.append(
		this.$editSummaryLabel,
		this.editSummaryInput.$element,
		this.$saveOptions,
		this.$saveFoot,
		this.$saveMessages
	);

	// Review panel
	this.reviewPanel = new OO.ui.PanelLayout( {
		expanded: false,
		scrollable: true,
		padded: true
	} );
	this.$reviewViewer = $( '<div>' ).addClass( 've-ui-mwSaveDialog-viewer' );
	this.$reviewEditSummary = $( '<span>' ).addClass( 've-ui-mwSaveDialog-summaryPreview' ).addClass( 'comment' );
	this.$reviewActions = $( '<div>' ).addClass( 've-ui-mwSaveDialog-actions' );
	this.reviewPanel.$element.append(
		$( '<div>' )
			.addClass( 'mw-summary-preview' )
			.text( ve.msg( 'summary-preview' ) )
			.append( $( '<br>' ), this.$reviewEditSummary ),
		this.$reviewViewer,
		this.$reviewActions
	);

	// Preview panel
	this.previewPanel = new OO.ui.PanelLayout( {
		expanded: false,
		scrollable: true,
		padded: true
	} );
	this.$previewViewer = $( '<div>' ).addClass( 'mw-body-content mw-content-' + mw.config.get( 'wgVisualEditor' ).pageLanguageDir );
	this.previewPanel.$element
		// Make focusable for keyboard accessible scrolling
		.prop( 'tabIndex', 0 )
		.append( this.$previewViewer );

	// Conflict panel
	this.conflictPanel = new OO.ui.PanelLayout( {
		expanded: false,
		scrollable: true,
		padded: true
	} );
	this.$conflict = $( '<div>' ).addClass( 've-ui-mwSaveDialog-conflict' )
		.html( ve.init.platform.getParsedMessage( 'visualeditor-editconflict' ) )
		.find( 'a' ).attr( 'target', '_blank' ).end();
	this.conflictPanel.$element.append( this.$conflict );

	// No changes panel
	this.nochangesPanel = new OO.ui.PanelLayout( {
		expanded: false,
		scrollable: true,
		padded: true
	} );
	this.$noChanges = $( '<div>' ).addClass( 've-ui-mwSaveDialog-nochanges' )
		.html( ve.init.platform.getParsedMessage( 'visualeditor-diff-nochanges' ) )
		.find( 'a' ).attr( 'target', '_blank' ).end();
	this.nochangesPanel.$element.append( this.$noChanges );

	// Panel stack
	this.panels.addItems( [
		this.savePanel,
		this.reviewPanel,
		this.previewPanel,
		this.conflictPanel,
		this.nochangesPanel
	] );

	// Save button for "save" panel
	saveAccessKey = ve.msg( 'accesskey-save' );
	if ( saveAccessKey !== '-' && saveAccessKey !== '' ) {
		this.actions.forEach( { actions: 'save' }, function ( action ) {
			action.setAccessKey( saveAccessKey );
		} );
	}

	// Initialization
	this.$body.append( this.panels.$element );

	this.setupDeferred.resolve();
};

/**
 * @inheritdoc
 * @param {Object} [data]
 * @param {boolean} [data.canReview] User can review changes
 * @param {boolean} [data.canPreview] User can preview changes
 * @param {OO.ui.FieldLayout[]} [data.checkboxFields] Checkbox fields
 * @param {Object} [data.checkboxesByName] Checkbox widgets, indexed by name
 * @param {string} [data.sectionTitle] Section title, if in new section mode
 * @param {string} [data.editSummary] Edit summary
 * @param {string} [data.initialPanel='save'] Initial panel to show
 * @param {jQuery|string|OO.ui.HtmlSnippet|Function|null} [data.saveButtonLabel] Label for the save button
 */
ve.ui.MWSaveDialog.prototype.getSetupProcess = function ( data ) {
	return ve.ui.MWSaveDialog.super.prototype.getSetupProcess.call( this, data )
		.next( function () {
			this.canReview = !!data.canReview;
			this.canPreview = !!data.canPreview;
			this.setupCheckboxes( data.checkboxFields || [] );
			this.checkboxesByName = data.checkboxesByName || {};

			if ( data.sectionTitle ) {
				this.setEditSummary( ve.msg( 'newsectionsummary', data.sectionTitle ) );
				this.editSummaryInput.setDisabled( true );
			} else {
				this.editSummaryInput.setDisabled( false );
				if ( !this.changedEditSummary ) {
					this.setEditSummary( data.editSummary );
				}
			}

			// Old messages should not persist
			this.clearAllMessages();
			// Don't focus during setup to prevent scroll jumping (T153010)
			this.swapPanel( data.initialPanel || 'save', true );
			// Update save button label
			if ( data.saveButtonLabel ) {
				this.actions.forEach( { actions: 'save' }, function ( action ) {
					action.setLabel( data.saveButtonLabel );
				} );
			}
		}, this );
};

/**
 * @inheritdoc
 */
ve.ui.MWSaveDialog.prototype.getReadyProcess = function ( data ) {
	return ve.ui.MWSaveDialog.super.prototype.getReadyProcess.call( this, data )
		.next( function () {
			// Support: Firefox
			// In Firefox, trying to focus a hidden input will throw an
			// exception. This would happen when opening the preview via
			// keyboard shortcut.
			if ( this.panels.getCurrentItem() === this.savePanel ) {
				// This includes a #focus call
				this.editSummaryInput.moveCursorToEnd();
			}
		}, this );
};

/**
 * @inheritdoc
 */
ve.ui.MWSaveDialog.prototype.getTeardownProcess = function ( data ) {
	return ve.ui.MWSaveDialog.super.prototype.getTeardownProcess.call( this, data )
		.next( function () {
			this.emit( 'close' );
		}, this );
};

/**
 * @inheritdoc
 */
ve.ui.MWSaveDialog.prototype.getActionProcess = function ( action ) {
	if ( action === 'save' ) {
		return new OO.ui.Process( function () {
			var saveDeferred = $.Deferred();
			this.swapPanel( 'save' );
			this.emit( 'save', saveDeferred );
			return saveDeferred.promise();
		}, this );
	}
	if ( action === 'review' || action === 'preview' || action === 'resolve' ) {
		return new OO.ui.Process( function () {
			this.emit( action );
		}, this );
	}
	if ( action === 'approve' ) {
		return new OO.ui.Process( function () {
			this.swapPanel( 'save' );
		}, this );
	}

	return ve.ui.MWSaveDialog.super.prototype.getActionProcess.call( this, action );
};

/**
 * @inheritdoc
 */
ve.ui.MWSaveDialog.prototype.getBodyHeight = function () {
	// Don't vary the height when the foot is made visible or not
	return this.panels.getCurrentItem().$element.outerHeight( true );
};

/**
 * Handle retry button click events.
 *
 * Hides errors and then tries again.
 */
ve.ui.MWSaveDialog.prototype.onRetryButtonClick = function () {
	this.emit( 'retry' );
	ve.ui.MWSaveDialog.super.prototype.onRetryButtonClick.apply( this, arguments );
};

/* Registration */

ve.ui.windowFactory.register( ve.ui.MWSaveDialog );
