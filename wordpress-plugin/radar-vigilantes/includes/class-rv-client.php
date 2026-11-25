<?php
/**
 * Push verso Radar: report completo + eventi, firmato con il secret del sito.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_Client {
	const INGEST_ROUTE = '/api/vigilantes/ingest';

	/**
	 * @param string $event   Motivo dell'invio (daily, connected, updated, admin_added…).
	 * @param array  $events  Dettagli facoltativi.
	 * @return true|string true se Radar ha accettato, altrimenti l'errore.
	 */
	public static function push( $event, array $events = array() ) {
		$conn = RV_Settings::connection();
		if ( ! $conn ) {
			return 'sito non collegato a Radar';
		}
		$body = wp_json_encode(
			array(
				'event'  => (string) $event,
				'events' => $events,
				'report' => RV_Collector::build(),
			)
		);
		if ( false === $body ) {
			return 'report non serializzabile';
		}
		$res = wp_remote_post(
			$conn['radar_url'] . self::INGEST_ROUTE,
			array(
				'timeout'     => 20,
				'redirection' => 0,
				'headers'     => array_merge(
					array(
						'Content-Type' => 'application/json',
						'User-Agent'   => 'Radar-Vigilantes/' . RADAR_VIGILANTES_VERSION . '; ' . home_url(),
					),
					RV_Signer::headers( $conn, 'POST', self::INGEST_ROUTE, $body )
				),
				'body'        => $body,
			)
		);
		if ( is_wp_error( $res ) ) {
			$err = $res->get_error_message();
		} else {
			$code = (int) wp_remote_retrieve_response_code( $res );
			$data = json_decode( wp_remote_retrieve_body( $res ), true );
			if ( is_array( $data ) && isset( $data['options'] ) ) {
				self::apply_options( $data['options'] );
			}
			$err = 200 === $code ? true : sprintf( 'HTTP %d: %s', $code, is_array( $data ) && isset( $data['error'] ) ? $data['error'] : 'risposta inattesa' );
		}
		RV_Settings::set_status(
			array(
				'last_push_at'    => time(),
				'last_push_event' => $event,
				'last_push_error' => true === $err ? null : $err,
			)
		);
		return $err;
	}

	/** Applica le opzioni di Radar; spegnere la scansione cancella i suoi risultati. */
	public static function apply_options( $options ) {
		$was = RV_Settings::deep_scan();
		RV_Settings::apply_remote_options( $options );
		if ( $was && ! RV_Settings::deep_scan() ) {
			RV_Tasks::clear_deep_results();
		}
	}
}
