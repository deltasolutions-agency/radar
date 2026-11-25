<?php
/**
 * Controlli periodici eseguiti entro un budget di tempo: lanciati dal cron
 * giornaliero di WordPress, dal controllo di Radar e dal pulsante in admin.
 * Ogni controllo scade dopo 24 ore; quelli lunghi sono incrementali.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_Tasks {
	const RESULTS   = 'radar_vigilantes_results';
	const PI_STATE  = 'radar_vigilantes_pi_state';
	const MAX_AGE   = 86400;

	public static function results() {
		$r = get_option( self::RESULTS, array() );
		return is_array( $r ) ? $r : array();
	}

	public static function set_result( $key, $value ) {
		$r         = self::results();
		$r[ $key ] = $value;
		update_option( self::RESULTS, $r, false );
	}

	public static function clear_deep_results() {
		$r = self::results();
		unset( $r['malware'], $r['plugin_integrity'] );
		update_option( self::RESULTS, $r, false );
		delete_option( self::PI_STATE );
		RV_Scanner::reset();
	}

	private static function due( $key, $force ) {
		if ( $force ) {
			return true;
		}
		$r = self::results();
		return empty( $r[ $key ]['checked_at'] ) || time() - (int) $r[ $key ]['checked_at'] > self::MAX_AGE;
	}

	/**
	 * Esegue i controlli scaduti finché c'è tempo.
	 *
	 * @param int  $budget Secondi a disposizione.
	 * @param bool $force  Ripete anche quelli non ancora scaduti.
	 */
	public static function run_due( $budget, $force = false ) {
		$deadline = microtime( true ) + max( 1, (int) $budget );
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( (int) $budget + 30 ); // phpcs:ignore
		}
		if ( self::due( 'integrity', $force ) ) {
			self::set_result( 'integrity', RV_Security::core_integrity() );
		}
		if ( microtime( true ) < $deadline && self::due( 'uploads_php', $force ) ) {
			self::set_result( 'uploads_php', RV_Security::uploads_php() );
		}
		if ( ! RV_Settings::deep_scan() ) {
			return;
		}
		if ( microtime( true ) < $deadline && ( self::due( 'plugin_integrity', $force ) || get_option( self::PI_STATE ) ) ) {
			self::plugin_integrity( $deadline );
		}
		if ( microtime( true ) < $deadline && ( self::due( 'malware', $force ) || RV_Scanner::in_progress() ) ) {
			RV_Scanner::run( $deadline );
		}
	}

	/** Integrità dei plugin wordpress.org, un plugin alla volta. */
	private static function plugin_integrity( $deadline ) {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		$plugins = get_plugins();
		ksort( $plugins );
		$files = array_keys( $plugins );
		$state = get_option( self::PI_STATE, array() );
		if ( ! is_array( $state ) || ! isset( $state['next'] ) ) {
			$state = array( 'next' => 0, 'checked' => 0, 'skipped' => 0, 'plugins' => array() );
		}
		while ( $state['next'] < count( $files ) ) {
			if ( microtime( true ) > $deadline ) {
				update_option( self::PI_STATE, $state, false );
				return;
			}
			$file = $files[ $state['next'] ];
			$res  = RV_Security::plugin_integrity( $file, $plugins[ $file ] );
			if ( null === $res ) {
				$state['skipped']++;
			} else {
				$state['checked']++;
				if ( $res['modified'] || $res['unknown'] ) {
					$state['plugins'][] = $res;
				}
			}
			$state['next']++;
		}
		self::set_result(
			'plugin_integrity',
			array(
				'checked_at' => time(),
				'checked'    => $state['checked'],
				'skipped'    => $state['skipped'],
				'plugins'    => $state['plugins'],
			)
		);
		delete_option( self::PI_STATE );
	}
}
