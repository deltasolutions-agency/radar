<?php
/**
 * Controlli di sicurezza "leggeri" (sempre attivi) e integrità dei plugin
 * wordpress.org (con la scansione approfondita).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_Security {
	const MAX_LIST = 200;

	/**
	 * Confronta i file del core con i checksum ufficiali. File estranei cercati
	 * in wp-admin, wp-includes e tra i .php della root.
	 */
	public static function core_integrity() {
		global $wp_version, $wp_local_package;
		require_once ABSPATH . 'wp-admin/includes/update.php';
		$locale    = ! empty( $wp_local_package ) ? $wp_local_package : 'en_US';
		$checksums = get_core_checksums( $wp_version, $locale );
		if ( ! is_array( $checksums ) && 'en_US' !== $locale ) {
			$checksums = get_core_checksums( $wp_version, 'en_US' );
		}
		$out = array(
			'checked_at' => time(),
			'ok'         => null,
			'modified'   => array(),
			'missing'    => array(),
			'unknown'    => array(),
			'error'      => null,
		);
		if ( ! is_array( $checksums ) ) {
			$out['error'] = 'checksum ufficiali non disponibili per questa versione';
			return $out;
		}
		$root = rtrim( wp_normalize_path( ABSPATH ), '/' ) . '/';
		foreach ( $checksums as $file => $md5 ) {
			if ( 0 === strpos( $file, 'wp-content/' ) ) {
				continue;
			}
			$path = $root . $file;
			if ( ! file_exists( $path ) ) {
				// File opzionali che l'installazione può non avere.
				if ( ! preg_match( '#^(readme\.html|license\.txt|wp-config-sample\.php)$#', $file ) ) {
					self::push( $out['missing'], $file );
				}
				continue;
			}
			if ( md5_file( $path ) !== $md5 ) {
				self::push( $out['modified'], $file );
			}
		}
		foreach ( array( 'wp-admin', 'wp-includes' ) as $dir ) {
			foreach ( RV_FS::walk( $root . $dir, array(), 50000 ) as $path ) {
				$rel = RV_FS::rel( $path );
				if ( ! isset( $checksums[ $rel ] ) && preg_match( RV_FS::PHP_EXT, $rel ) ) {
					self::push( $out['unknown'], $rel );
				}
			}
		}
		foreach ( (array) glob( $root . '*.php' ) as $path ) {
			$rel = RV_FS::rel( $path );
			if ( 'wp-config.php' !== $rel && ! isset( $checksums[ $rel ] ) ) {
				self::push( $out['unknown'], $rel );
			}
		}
		$out['ok'] = ! $out['modified'] && ! $out['missing'] && ! $out['unknown'];
		return $out;
	}

	/** File PHP dentro uploads (esclusi gli index.php "silenziosi"). */
	public static function uploads_php() {
		$up    = wp_upload_dir( null, false );
		$base  = isset( $up['basedir'] ) ? $up['basedir'] : WP_CONTENT_DIR . '/uploads';
		$out   = array(
			'checked_at' => time(),
			'files'      => array(),
			'truncated'  => false,
		);
		if ( ! is_dir( $base ) ) {
			return $out;
		}
		foreach ( RV_FS::walk( $base, array(), 300000 ) as $path ) {
			if ( ! preg_match( RV_FS::PHP_EXT, $path ) || RV_FS::is_silence_index( $path ) ) {
				continue;
			}
			if ( count( $out['files'] ) >= self::MAX_LIST ) {
				$out['truncated'] = true;
				break;
			}
			$out['files'][] = RV_FS::rel( $path );
		}
		return $out;
	}

	/**
	 * Integrità di UN plugin wordpress.org rispetto ai checksum della sua versione.
	 *
	 * @return array|null null se il plugin non è su wordpress.org (premium, custom).
	 */
	public static function plugin_integrity( $plugin_file, array $data ) {
		$slug = dirname( $plugin_file );
		if ( '.' === $slug || empty( $data['Version'] ) ) {
			return null; // plugin a file singolo o senza versione
		}
		$url = sprintf(
			'https://downloads.wordpress.org/plugin-checksums/%s/%s.json',
			rawurlencode( $slug ),
			rawurlencode( $data['Version'] )
		);
		$res = wp_remote_get( $url, array( 'timeout' => 10 ) );
		if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			return null;
		}
		$json = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( ! is_array( $json ) || empty( $json['files'] ) || ! is_array( $json['files'] ) ) {
			return null;
		}
		$dir      = wp_normalize_path( WP_PLUGIN_DIR . '/' . $slug );
		$modified = array();
		$unknown  = array();
		foreach ( $json['files'] as $file => $sums ) {
			$path = $dir . '/' . $file;
			if ( ! file_exists( $path ) || ! preg_match( '/\.(php\d?|phtml|phar|inc|js)$/i', $file ) ) {
				continue; // contano solo i file eseguibili
			}
			$md5 = isset( $sums['md5'] ) ? (array) $sums['md5'] : array();
			if ( $md5 && ! in_array( md5_file( $path ), $md5, true ) ) {
				self::push( $modified, $file );
			}
		}
		foreach ( RV_FS::walk( $dir, array(), 50000 ) as $path ) {
			$rel = substr( wp_normalize_path( $path ), strlen( $dir ) + 1 );
			if ( ! isset( $json['files'][ $rel ] ) && preg_match( RV_FS::PHP_EXT, $rel ) && ! RV_FS::is_silence_index( $path ) ) {
				self::push( $unknown, $rel );
			}
		}
		return array(
			'slug'     => $plugin_file,
			'name'     => isset( $data['Name'] ) ? $data['Name'] : $slug,
			'version'  => $data['Version'],
			'modified' => $modified,
			'unknown'  => $unknown,
		);
	}

	private static function push( array &$list, $item ) {
		if ( count( $list ) < self::MAX_LIST ) {
			$list[] = $item;
		}
	}
}
