/* tslint:disable */
/* eslint-disable */

export function advance_level(): void;

export function game_init(best: number, seed: number): void;

export function get_ball_hold_ticks(): number;

export function get_ball_x(): number;

export function get_ball_y(): number;

export function get_best(): number;

export function get_cam_x_target(): number;

export function get_current_level(): number;

export function get_game_state(): number;

export function get_landed_platform_music(): number;

export function get_landing_count(): number;

export function get_level_end_x(): number;

export function get_level_progress(): number;

export function get_level_trans_tick(): number;

export function get_num_levels(): number;

export function get_score(): number;

export function get_tick(): number;

export function get_visible_platforms(min_x: number, max_x: number): Float64Array;

export function restart(seed: number): void;

export function update(left: boolean, right: boolean): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly advance_level: () => void;
    readonly get_current_level: () => number;
    readonly get_level_end_x: () => number;
    readonly get_num_levels: () => number;
    readonly get_visible_platforms: (a: number, b: number) => [number, number];
    readonly update: (a: number, b: number) => void;
    readonly get_ball_hold_ticks: () => number;
    readonly get_ball_x: () => number;
    readonly get_ball_y: () => number;
    readonly get_best: () => number;
    readonly get_cam_x_target: () => number;
    readonly get_game_state: () => number;
    readonly get_landed_platform_music: () => number;
    readonly get_landing_count: () => number;
    readonly get_score: () => number;
    readonly get_tick: () => number;
    readonly game_init: (a: number, b: number) => void;
    readonly get_level_trans_tick: () => number;
    readonly get_level_progress: () => number;
    readonly restart: (a: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
