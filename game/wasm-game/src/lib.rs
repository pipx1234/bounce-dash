use std::cell::RefCell;
use wasm_bindgen::prelude::*;

const W: f64 = 800.0;
const H_C: f64 = 480.0;

const GRAVITY: f64 = 0.46;
const MAX_FALL: f64 = 16.0;
const H_ACCEL: f64 = 0.55;
const MAX_H: f64 = 6.5;
const MAX_H_BOOST: f64 = 14.5;
const BOOST_TICKS: f64 = 45.0;
const H_FRIC: f64 = 0.78;
const BOUNCE: f64 = 0.80;
const MIN_BOUNCE: f64 = 13.5;
const BALL_R: f64 = 11.0;

const START_X: f64 = 200.0;
const PLATFORM_W: f64 = 82.0;
const PLATFORM_Y_MIN: f64 = 108.0;
const PLATFORM_Y_MAX: f64 = 404.0;
const STREAM_AHEAD: f64 = 2600.0;
const CLEAN_BEHIND: f64 = 360.0;

struct Rng {
    seed: u32,
}

impl Rng {
    fn new(seed: u32) -> Self {
        let mixed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        Self { seed: if mixed == 0 { 1 } else { mixed } }
    }

    fn next(&mut self) -> f64 {
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 17;
        self.seed ^= self.seed << 5;
        self.seed as f64 / 4294967296.0
    }
}

fn lerp(start: f64, end: f64, amount: f64) -> f64 {
    start + (end - start) * amount.max(0.0).min(1.0)
}

fn difficulty_at_x(x: f64) -> f64 {
    let meters = ((x - START_X) / 10.0).max(0.0);
    (meters / 2200.0).min(1.0).powf(0.85)
}

#[derive(Clone)]
struct Platform {
    x: f64,
    y: f64,
    w: f64,
    t: f64,
    visual_band: usize,
    lit: u32,
    falling: bool,
    fall_vy: f64,
    angle: f64,
}

struct Ball {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    hold_ticks: f64,
    hold_dir: f64,
}

struct Game {
    ball: Ball,
    cam_x_target: f64,
    platforms: Vec<Platform>,
    score: u32,
    best: u32,
    state: u32,
    next_cluster_x: f64,
    path_y: f64,
    rng: Rng,
    tick: u32,
}

impl Game {
    fn new() -> Self {
        let mut game = Self {
            ball: Ball { x: START_X, y: 330.0, vx: 0.0, vy: -12.0, hold_ticks: 0.0, hold_dir: 0.0 },
            cam_x_target: 0.0,
            platforms: Vec::new(),
            score: 0,
            best: 0,
            state: 0,
            next_cluster_x: 0.0,
            path_y: 360.0,
            rng: Rng::new(1),
            tick: 0,
        };
        game.reset_with_seed(1);
        game
    }

    fn reset_with_seed(&mut self, seed: u32) {
        self.ball = Ball { x: START_X, y: 330.0, vx: 0.0, vy: -12.0, hold_ticks: 0.0, hold_dir: 0.0 };
        self.cam_x_target = 0.0;
        self.platforms.clear();
        self.score = 0;
        self.state = 0;
        self.tick = 0;
        self.rng = Rng::new(seed);

        let opening = [
            (42.0, 420.0),
            (126.0, 372.0),
            (205.0, 430.0),
            (284.0, 304.0),
            (358.0, 382.0),
            (448.0, 260.0),
            (525.0, 335.0),
            (604.0, 406.0),
            (686.0, 286.0),
            (764.0, 360.0),
            (848.0, 248.0),
        ];

        for (x, y) in opening {
            self.platforms.push(Platform {
                x,
                y,
                w: PLATFORM_W,
                t: 0.0,
                visual_band: 0,
                lit: 0,
                falling: false,
                fall_vy: 0.0,
                angle: 0.0,
            });
        }

        self.path_y = 360.0;
        self.next_cluster_x = 880.0;
        self.spawn_until(START_X + STREAM_AHEAD);
    }

    fn push_platform(&mut self, x: f64, y: f64, difficulty: f64) {
        self.platforms.push(Platform {
            x,
            y,
            w: PLATFORM_W,
            t: difficulty,
            visual_band: (difficulty * 4.999).floor() as usize,
            lit: 0,
            falling: false,
            fall_vy: 0.0,
            angle: 0.0,
        });
    }

    fn gen_next_cluster(&mut self) {
        let difficulty = difficulty_at_x(self.next_cluster_x);
        let vertical_span = lerp(54.0, 128.0, difficulty);
        let raw_delta = (self.rng.next() * 2.0 - 1.0) * vertical_span;
        let path_y = (self.path_y + raw_delta).max(PLATFORM_Y_MIN).min(PLATFORM_Y_MAX);

        let upward = (self.path_y - path_y).max(0.0);
        let downward = (path_y - self.path_y).max(0.0);
        let min_gap = lerp(60.0, 108.0, difficulty);
        let desired_max_gap = lerp(126.0, 212.0, difficulty);
        let reachable_gap = lerp(76.0, 196.0, difficulty) - upward * 0.62 + downward * 0.18;
        let max_gap = desired_max_gap.min(reachable_gap).max(min_gap + 14.0);
        let gap = lerp(min_gap, max_gap, self.rng.next());
        let path_x = self.next_cluster_x + gap;
        let cluster_radius = lerp(260.0, 160.0, difficulty);
        let decoy_count = lerp(6.0, 2.0, difficulty).round() as usize;

        self.push_platform(path_x, path_y, difficulty);
        for _ in 0..decoy_count {
            let scatter_x = path_x + (self.rng.next() * 2.0 - 1.0) * cluster_radius;
            let x = scatter_x.max(self.next_cluster_x - 50.0);
            let y = lerp(PLATFORM_Y_MIN, PLATFORM_Y_MAX, self.rng.next());
            self.push_platform(x, y, difficulty);
        }

        self.path_y = path_y;
        self.next_cluster_x = path_x + lerp(88.0, 172.0, difficulty);
    }

    fn spawn_until(&mut self, target_x: f64) {
        while self.next_cluster_x < target_x {
            self.gen_next_cluster();
        }
    }

    fn resolve_platforms(&mut self) {
        for platform in self.platforms.iter_mut() {
            if platform.falling { continue; }
            if self.ball.x + BALL_R < platform.x || self.ball.x - BALL_R > platform.x + platform.w { continue; }
            if self.ball.vy <= 0.0 { continue; }
            let previous_bottom = (self.ball.y - self.ball.vy) + BALL_R;
            let current_bottom = self.ball.y + BALL_R;
            if previous_bottom <= platform.y && current_bottom >= platform.y {
                self.ball.y = platform.y - BALL_R;
                self.ball.vy = -(self.ball.vy.abs() * BOUNCE).max(MIN_BOUNCE);
                platform.lit = 8;
                platform.falling = true;
                platform.fall_vy = 1.5;
                platform.angle = 0.0;
                break;
            }
        }
    }

    fn tick_falling(&mut self) {
        for platform in self.platforms.iter_mut() {
            if platform.falling {
                platform.fall_vy += 0.35;
                platform.y += platform.fall_vy;
                platform.angle += 0.03;
            }
        }
    }

    fn update(&mut self, left: bool, right: bool) {
        if self.state != 0 { return; }

        self.tick += 1;

        if left || right {
            let direction = if right { 1.0 } else { -1.0 };
            if (direction - self.ball.hold_dir).abs() > 0.5 {
                self.ball.hold_ticks = 0.0;
                self.ball.hold_dir = direction;
            }
            self.ball.hold_ticks = (self.ball.hold_ticks + 1.0).min(BOOST_TICKS);
        } else {
            self.ball.hold_ticks = (self.ball.hold_ticks - 3.0).max(0.0);
            self.ball.hold_dir = 0.0;
        }

        let charge = self.ball.hold_ticks / BOOST_TICKS;
        let dynamic_max_h = lerp(MAX_H, MAX_H_BOOST, charge);
        let dynamic_accel = H_ACCEL * (1.0 + charge * 1.2);

        if left { self.ball.vx = (self.ball.vx - dynamic_accel).max(-dynamic_max_h); }
        if right { self.ball.vx = (self.ball.vx + dynamic_accel).min(dynamic_max_h); }
        if !left && !right { self.ball.vx *= H_FRIC; }
        if self.ball.vx.abs() < 0.05 { self.ball.vx = 0.0; }

        self.ball.vy = (self.ball.vy + GRAVITY).min(MAX_FALL);
        self.ball.x += self.ball.vx;
        self.ball.y += self.ball.vy;

        self.resolve_platforms();

        let distance = (((self.ball.x - START_X) / 10.0).floor() as i64).max(0) as u32;
        if distance > self.score { self.score = distance; }
        if self.score > self.best { self.best = self.score; }

        self.cam_x_target = (self.ball.x - W * 0.35).max(0.0);
        self.spawn_until(self.cam_x_target + STREAM_AHEAD);
        self.tick_falling();

        let camera = self.cam_x_target;
        self.platforms.retain(|platform| platform.x + platform.w > camera - CLEAN_BEHIND && platform.y < H_C + 140.0);

        for platform in self.platforms.iter_mut() {
            if platform.lit > 0 { platform.lit -= 1; }
        }

        if self.ball.y - BALL_R > H_C + 20.0 {
            self.state = 2;
        }
    }
}

thread_local! {
    static GAME: RefCell<Game> = RefCell::new(Game::new());
}

#[wasm_bindgen]
pub fn game_init(best: u32, seed: u32) {
    GAME.with(|game_cell| {
        let mut game = game_cell.borrow_mut();
        game.reset_with_seed(seed.max(1));
        game.best = best;
    });
}

#[wasm_bindgen]
pub fn update(left: bool, right: bool) {
    GAME.with(|game_cell| game_cell.borrow_mut().update(left, right));
}

#[wasm_bindgen]
pub fn restart(seed: u32) {
    GAME.with(|game_cell| {
        let best = game_cell.borrow().best;
        let mut game = game_cell.borrow_mut();
        game.reset_with_seed(seed.max(1));
        game.best = best;
    });
}

#[wasm_bindgen]
pub fn advance_level() {}

#[wasm_bindgen] pub fn get_ball_x() -> f64 { GAME.with(|game_cell| game_cell.borrow().ball.x) }
#[wasm_bindgen] pub fn get_ball_y() -> f64 { GAME.with(|game_cell| game_cell.borrow().ball.y) }
#[wasm_bindgen] pub fn get_ball_hold_ticks() -> f64 { GAME.with(|game_cell| game_cell.borrow().ball.hold_ticks) }
#[wasm_bindgen] pub fn get_cam_x_target() -> f64 { GAME.with(|game_cell| game_cell.borrow().cam_x_target) }
#[wasm_bindgen] pub fn get_score() -> u32 { GAME.with(|game_cell| game_cell.borrow().score) }
#[wasm_bindgen] pub fn get_best() -> u32 { GAME.with(|game_cell| game_cell.borrow().best) }
#[wasm_bindgen] pub fn get_game_state() -> u32 { GAME.with(|game_cell| game_cell.borrow().state) }
#[wasm_bindgen] pub fn get_current_level() -> u32 { 0 }
#[wasm_bindgen] pub fn get_level_trans_tick() -> u32 { 0 }
#[wasm_bindgen] pub fn get_tick() -> u32 { GAME.with(|game_cell| game_cell.borrow().tick) }
#[wasm_bindgen] pub fn get_num_levels() -> u32 { 1 }

#[wasm_bindgen]
pub fn get_level_end_x() -> f64 { -1.0 }

#[wasm_bindgen]
pub fn get_level_progress() -> f64 {
    GAME.with(|game_cell| difficulty_at_x(game_cell.borrow().ball.x))
}

#[wasm_bindgen]
pub fn get_visible_platforms(min_x: f64, max_x: f64) -> Vec<f64> {
    GAME.with(|game_cell| {
        let game = game_cell.borrow();
        let mut output = Vec::new();
        for platform in &game.platforms {
            if platform.x + platform.w < min_x || platform.x > max_x { continue; }
            output.push(platform.x);
            output.push(platform.y);
            output.push(platform.w);
            output.push(platform.t);
            output.push(platform.visual_band as f64);
            output.push(platform.lit as f64);
            output.push(if platform.falling { 1.0 } else { 0.0 });
            output.push(platform.fall_vy);
            output.push(platform.angle);
        }
        output
    })
}