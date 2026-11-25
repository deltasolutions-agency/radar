<?php
/**
 * Eventi che fanno partire un push verso Radar, e cron giornaliero.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_Events {
	const DAILY = 'radar_vigilantes_daily';
	const PUSH  = 'radar_vigilantes_push';

	public static function init() {
		add_action( self::DAILY, array( __CLASS__, 'daily' ) );
		add_action( self::PUSH, array( __CLASS__, 'scheduled_push' ) );

		add_action( 'upgrader_process_complete', array( __CLASS__, 'after_upgrade' ), 20, 0 );
		add_action( 'activated_plugin', array( __CLASS__, 'changed' ), 10, 0 );
		add_action( 'deactivated_plugin', array( __CLASS__, 'changed' ), 10, 0 );
		add_action( 'deleted_plugin', array( __CLASS__, 'changed' ), 10, 0 );
		add_action( 'switch_theme', array( __CLASS__, 'changed' ), 10, 0 );
		add_action( 'deleted_theme', array( __CLASS__, 'changed' ), 10, 0 );

		add_action( 'user_register', array( __CLASS__, 'maybe_admin' ), 20, 1 );
		add_action( 'set_user_role', array( __CLASS__, 'role_set' ), 20, 2 );
		add_action( 'add_user_role', array( __CLASS__, 'role_set' ), 20, 2 );
		add_action( 'granted_super_admin', array( __CLASS__, 'maybe_admin' ), 20, 1 );

		// Il cron giornaliero può essere stato perso (es. migrazione del sito).
		add_action( 'init', array( __CLASS__, 'ensure_daily' ) );
	}

	public static function activate() {
		$o = RV_Settings::all();
		unset( $o['deactivated_by'], $o['deactivated_at'] );
		update_option( RV_Settings::OPTION, $o, false );
		RV_Guard::ensure_loader();
		self::ensure_daily();
		if ( RV_Settings::connection() ) {
			self::schedule( 'reactivated', 0 );
		}
	}

	/**
	 * Disattivazione dal pannello: registrata e segnalata subito a Radar. Se il
	 * loader in mu-plugins è presente il plugin continua comunque a funzionare.
	 */
	public static function deactivate() {
		$o                   = RV_Settings::all();
		$o['deactivated_by'] = RV_Guard::current_login();
		$o['deactivated_at'] = time();
		update_option( RV_Settings::OPTION, $o, false );
		RV_Client::push( 'deactivated', array( array( 'type' => 'deactivated', 'user' => $o['deactivated_by'] ) ) );
		if ( ! RV_Guard::loader_present() ) {
			wp_clear_scheduled_hook( self::DAILY );
			wp_clear_scheduled_hook( self::PUSH );
		}
	}

	public static function ensure_daily() {
		if ( ! wp_next_scheduled( self::DAILY ) ) {
			wp_schedule_event( time() + wp_rand( 300, 3600 ), 'daily', self::DAILY );
		}
	}

	public static function daily() {
		RV_Guard::ensure_loader(); // anche dopo un aggiornamento automatico (l'attivazione non riparte)
		RV_Tasks::run_due( 50 );
		RV_Client::push( 'daily' );
	}

	/** Push differito (accorpa più eventi ravvicinati in un solo invio). */
	public static function schedule( $event, $delay ) {
		if ( ! RV_Settings::connection() ) {
			return;
		}
		$args = array( $event );
		if ( ! wp_next_scheduled( self::PUSH, $args ) ) {
			wp_schedule_single_event( time() + $delay, self::PUSH, $args );
		}
	}

	public static function scheduled_push( $event = 'event' ) {
		if ( 'updated' === $event ) {
			RV_Collector::refresh_updates( 0 );
		}
		RV_Client::push( $event );
	}

	public static function after_upgrade() {
		self::schedule( 'updated', 60 );
	}

	public static function changed() {
		self::schedule( 'changed', 30 );
	}

	public static function role_set( $user_id, $role ) {
		if ( 'administrator' === $role ) {
			self::admin_event( $user_id );
		}
	}

	public static function maybe_admin( $user_id ) {
		$u = get_userdata( $user_id );
		if ( $u && ( in_array( 'administrator', (array) $u->roles, true ) || is_super_admin( $user_id ) ) ) {
			self::admin_event( $user_id );
		}
	}

	private static function admin_event( $user_id ) {
		self::schedule( 'admin_added', 0 );
		if ( function_exists( 'spawn_cron' ) ) {
			spawn_cron();
		}
	}
}
