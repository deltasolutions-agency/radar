<?php
/**
 * Utilità file system: visita ricorsiva deterministica (ordine alfabetico),
 * senza seguire i link simbolici, con esclusioni e limite di voci.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_FS {
	const PHP_EXT = '/\.(php\d?|phtml|phar|inc)$/i';

	/**
	 * Generatore dei file (percorsi assoluti) sotto $dir.
	 *
	 * @param string   $dir     Cartella di partenza.
	 * @param string[] $exclude Percorsi assoluti da saltare (cartelle o file).
	 * @param int      $max     Numero massimo di voci visitate.
	 */
	public static function walk( $dir, array $exclude = array(), $max = 300000 ) {
		$dir     = rtrim( wp_normalize_path( $dir ), '/' );
		$exclude = array_map(
			function ( $p ) {
				return rtrim( wp_normalize_path( $p ), '/' );
			},
			$exclude
		);
		$stack   = array( $dir );
		$visited = 0;
		while ( $stack ) {
			$cur     = array_pop( $stack );
			$entries = @scandir( $cur ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
			if ( ! is_array( $entries ) ) {
				continue;
			}
			$subdirs = array();
			foreach ( $entries as $e ) {
				if ( '.' === $e || '..' === $e ) {
					continue;
				}
				if ( ++$visited > $max ) {
					return;
				}
				$path = $cur . '/' . $e;
				if ( in_array( $path, $exclude, true ) || is_link( $path ) ) {
					continue;
				}
				if ( is_dir( $path ) ) {
					if ( in_array( $e, array( '.git', 'node_modules', '.svn' ), true ) ) {
						continue;
					}
					$subdirs[] = $path;
				} elseif ( is_file( $path ) ) {
					yield $path;
				}
			}
			// Ordine alfabetico: le sottocartelle vanno in pila al contrario.
			for ( $i = count( $subdirs ) - 1; $i >= 0; $i-- ) {
				$stack[] = $subdirs[ $i ];
			}
		}
	}

	/** Percorso relativo ad ABSPATH, per i report. */
	public static function rel( $path ) {
		$root = rtrim( wp_normalize_path( ABSPATH ), '/' ) . '/';
		$path = wp_normalize_path( $path );
		return 0 === strpos( $path, $root ) ? substr( $path, strlen( $root ) ) : $path;
	}

	/**
	 * index.php "di protezione" che molti plugin mettono nelle cartelle (es.
	 * "<?php // Silence is golden" o un header 403): piccolo e senza variabili,
	 * inclusioni o funzioni pericolose. Non sospetto.
	 */
	public static function is_silence_index( $path ) {
		if ( 'index.php' !== strtolower( basename( $path ) ) ) {
			return false;
		}
		$size = @filesize( $path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		if ( false === $size || $size > 1024 ) {
			return false;
		}
		$c    = (string) @file_get_contents( $path ); // phpcs:ignore
		$code = (string) preg_replace( '#/\*.*?\*/|//[^\n]*|\#[^\n]*#s', '', $c );
		if ( preg_match( '/[\$`]|\b(?:include|require)(?:_once)?\b/i', $code ) ) {
			return false;
		}
		// Ammesse solo chiamate innocue: header, http_response_code, exit/die, defined.
		if ( preg_match_all( '/\b([a-z_][a-z0-9_]*)\s*\(/i', $code, $m ) ) {
			foreach ( $m[1] as $fn ) {
				if ( ! in_array( strtolower( $fn ), array( 'header', 'http_response_code', 'exit', 'die', 'defined' ), true ) ) {
					return false;
				}
			}
		}
		return true;
	}
}
