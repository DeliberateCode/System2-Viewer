// Golden fixture for Rust AST visitor tests

use std::io::Read;
use std::collections::{HashMap, HashSet};
use std::fmt::*;

extern crate serde;

mod utils;

pub fn process_data(input: &str) -> String {
    input.to_uppercase()
}

fn helper_function() -> bool {
    true
}

#[derive(Debug, Clone)]
pub struct Config {
    pub name: String,
    pub value: i32,
}

pub(crate) struct InternalState {
    counter: usize,
}

pub trait Processor {
    fn process(&self) -> Result<(), String>;
}

pub enum Status {
    Active,
    Inactive,
    Pending,
}

pub const MAX_RETRIES: u32 = 3;

pub static GLOBAL_NAME: &str = "system2";

pub type ResultAlias = Result<String, Box<dyn std::error::Error>>;

impl Config {
    pub fn new(name: String, value: i32) -> Self {
        Config { name, value }
    }
}

impl Processor for Config {
    fn process(&self) -> Result<(), String> {
        Ok(())
    }
}

pub(super) fn restricted_fn() -> u32 {
    42
}

pub async fn async_process<T: Clone>(item: T) -> T {
    item.clone()
}

pub fn generic_with_lifetime<'a>(s: &'a str) -> &'a str {
    s
}

static INTERNAL_COUNTER: u32 = 0;

const LOCAL_LIMIT: usize = 100;
