<?php
/**
 * Scansione euristica del codice (con la "scansione approfondita" attiva):
 * cerca nei file PHP di wp-content e della root gli schemi tipici di
 * malware, backdoor e codice offuscato. Solo lettura: non modifica nulla.
 *
 * È incrementale: ogni esecuzione lavora entro un budget di tempo e riprende
 * da dove si era fermata; a ciclo completo i risultati vengono pubblicati.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class RV_Scanner {
	const STATE        = 'radar_vigilantes_scan_state';
	const MAX_FINDINGS = 200;
	const MAX_BYTES    = 3145728; // 3 MB per file

	/** Regole: id => [severità, etichetta, regex]. */
	public static function rules() {
		$decoders = '(?:base64_decode|gzinflate|gzuncompress|gzdecode|str_rot13|strrev|rawurldecode|hex2bin|convert_uudecode)';
		$input    = '\$_(?:GET|POST|REQUEST|COOKIE|SERVER|FILES)\b';
		return array(
			'eval_decode'      => array( 'high', 'eval/assert di contenuto decodificato', '/\b(?:eval|assert)\s*\(\s*@?\s*' . $decoders . '\s*\(/i' ),
			'exec_input'       => array( 'high', 'esecuzione di codice/comandi da input esterno', '/\b(?:eval|assert|create_function|system|shell_exec|passthru|exec|popen|proc_open|pcntl_exec)\s*\(\s*@?\s*(?:stripslashes\s*\(\s*)?' . $input . '/i' ),
			'call_input'       => array( 'high', 'funzione chiamata con nome preso dall\'input', '/' . $input . '\s*\[[^\]]{1,40}\]\s*\(/i' ),
			'preg_e'           => array( 'high', 'preg_replace con modificatore /e', '/preg_replace\s*\(\s*[\'"](.).{0,200}?\1[a-df-zA-Z]*e[a-zA-Z]*[\'"]\s*,/s' ),
			'webshell_name'    => array( 'high', 'firma di webshell nota', '/(?:c99shell|r57shell|b374k|FilesMan|IndoXploit|WSO\s+[\d.]+|alfa[-_ ]?shell|Sh3ll\s+By|uname\s*-a.{0,40}passthru)/i' ),
			'include_media'    => array( 'high', 'include di un file non PHP (immagine/testo)', '/\b(?:include|require)(?:_once)?\s*\(?\s*[\'"][^\'"]{1,200}\.(?:ico|png|jpe?g|gif|txt|css|svg)[\'"]/i' ),
			'decode_chain'     => array( 'medium', 'catena di decodifiche annidate', '/' . $decoders . '\s*\(\s*' . $decoders . '\s*\(/i' ),
			'globals_obf'      => array( 'medium', 'funzioni nascoste in $GLOBALS (offuscatore)', '/\$GLOBALS\s*\[\s*[\'"][^\'"]{1,40}[\'"]\s*\]\s*\[\s*\d+\s*\]\s*\(/' ),
			'long_base64'      => array( 'medium', 'stringa base64 molto lunga', '/[\'"][A-Za-z0-9+\/]{2000,}={0,2}[\'"]/' ),
			'hex_escapes'      => array( 'medium', 'lunga sequenza di escape esadecimali', '/(?:\\\\x[0-9a-fA-F]{2}){60,}/' ),
			'chr_concat'       => array( 'medium', 'stringa costruita con chr() concatenati', '/(?:chr\s*\(\s*\d{1,3}\s*\)\s*\.\s*){20,}/i' ),
			'var_func_decode'  => array( 'medium', 'funzione variabile su contenuto decodificato', '/\$[a-zA-Z_]\w*\s*\(\s*' . $decoders . '\s*\(/' ),
		);
	}

	/** Cartelle da analizzare ed esclusioni. */
	private static function roots() {
		return array( WP_CONTENT_DIR );
	}

	private static function excluded() {
		return array(
			RADAR_VIGILANTES_DIR, // le regole stesse comparirebbero come sospette
			WP_CONTENT_DIR . '/cache',
			WP_CONTENT_DIR . '/upgrade',
			WP_CONTENT_DIR . '/upgrade-temp-backup',
			WP_CONTENT_DIR . '/litespeed',
		);
	}

	/** Analizza un singolo file. @return array[] segnalazioni. */
	public static function scan_file( $path ) {
		$found = array();
		$name  = basename( $path );
		if ( '.' === $name[0] && preg_match( RV_FS::PHP_EXT, $name ) ) {
			$found[] = self::finding( $path, 'hidden_php', 'high', 'file PHP nascosto (nome che inizia con il punto)', null, '' );
		}
		$size = @filesize( $path ); // phpcs:ignore
		if ( false === $size || 0 === $size ) {
			return $found;
		}
		$fh = @fopen( $path, 'rb' ); // phpcs:ignore
		if ( ! $fh ) {
			return $found;
		}
		$content = (string) fread( $fh, self::MAX_BYTES );
		fclose( $fh );

		foreach ( self::rules() as $id => $rule ) {
			if ( preg_match( $rule[2], $content, $m, PREG_OFFSET_CAPTURE ) ) {
				$found[] = self::finding( $path, $id, $rule[0], $rule[1], $content, $m[0][1] );
			}
		}
		// Righe lunghissime: tipiche del codice offuscato (non dei sorgenti normali).
		if ( preg_match( '/[^\n]{30000,}/', $content, $m, PREG_OFFSET_CAPTURE ) && preg_match( '/\b(?:eval|assert|base64_decode|gzinflate|str_rot13)\b/i', $content ) ) {
			$found[] = self::finding( $path, 'long_line', 'medium', 'riga lunghissima con funzioni di decodifica', $content, $m[0][1] );
		}
		return $found;
	}

	private static function finding( $path, $rule, $severity, $label, $content, $offset ) {
		$line    = null;
		$excerpt = null;
		if ( is_string( $content ) && is_int( $offset ) ) {
			$line    = substr_count( $content, "\n", 0, $offset ) + 1;
			$excerpt = substr( $content, max( 0, $offset - 40 ), 200 );
			$excerpt = preg_replace( '/[^\x20-\x7E]/', ' ', $excerpt );
			$excerpt = preg_replace( '/\s+/', ' ', $excerpt );
		}
		return array(
			'file'     => RV_FS::rel( $path ),
			'rule'     => $rule,
			'label'    => $label,
			'severity' => $severity,
			'line'     => $line,
			'excerpt'  => $excerpt,
		);
	}

	/**
	 * Avanza la scansione entro $deadline (microtime). Restituisce true quando
	 * un ciclo completo è stato pubblicato in questa chiamata.
	 */
	public static function run( $deadline ) {
		$state = get_option( self::STATE, array() );
		if ( ! is_array( $state ) || empty( $state['cycle_started'] ) ) {
			$state = array(
				'cycle_started' => time(),
				'skip'          => 0,
				'scanned'       => 0,
				'findings'      => array(),
				'truncated'     => false,
			);
		}
		$index = 0;
		$done  = true;
		$files = self::files();
		foreach ( $files as $path ) {
			if ( $index++ < $state['skip'] ) {
				continue;
			}
			if ( microtime( true ) > $deadline ) {
				$done = false;
				break;
			}
			foreach ( self::scan_file( $path ) as $f ) {
				if ( count( $state['findings'] ) >= self::MAX_FINDINGS ) {
					$state['truncated'] = true;
					break;
				}
				$state['findings'][] = $f;
			}
			$state['skip']++;
			$state['scanned']++;
		}
		if ( ! $done ) {
			update_option( self::STATE, $state, false );
			return false;
		}
		RV_Tasks::set_result(
			'malware',
			array(
				'checked_at' => time(),
				'complete'   => true,
				'scanned'    => $state['scanned'],
				'truncated'  => $state['truncated'],
				'findings'   => $state['findings'],
			)
		);
		delete_option( self::STATE );
		return true;
	}

	/** Ciclo in corso? (per il report: "scansione in corso"). */
	public static function in_progress() {
		$s = get_option( self::STATE, array() );
		return is_array( $s ) && ! empty( $s['cycle_started'] );
	}

	public static function reset() {
		delete_option( self::STATE );
	}

	/** File PHP da analizzare: wp-content (escluse cache) e .php della root. */
	private static function files() {
		$root = rtrim( wp_normalize_path( ABSPATH ), '/' ) . '/';
		foreach ( (array) glob( $root . '*.php' ) as $p ) {
			yield $p;
		}
		foreach ( (array) glob( $root . '.*.php' ) as $p ) {
			yield $p;
		}
		foreach ( self::roots() as $dir ) {
			foreach ( RV_FS::walk( $dir, self::excluded() ) as $p ) {
				if ( preg_match( RV_FS::PHP_EXT, $p ) ) {
					yield $p;
				}
			}
		}
	}
}
