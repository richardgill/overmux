# Third-party notices

`overmux.wasm` uses Zellij's plugin API and Rust dependencies. Their licenses
are independent of the license for original Overmux code. Keep this file and
`THIRD_PARTY_LICENSES.txt` with distributions of the plugin.

## Scope

The inventory below covers the 128 registry packages resolved by
`cargo metadata --locked --filter-platform wasm32-wasip1` from `plugin/Cargo.lock`.
It conservatively includes build-time/procedural-macro dependencies and code
that the linker may omit; it is not a claim that every listed crate contributes
bytes to the executable. No third-party crate source modifications are applied.

- Lockfile SHA-256: `c81d37cfd25900361f94670ad1901eaabe976f3b394fd5785d02c7f0aae0216a`.
- Reviewed WASM SHA-256: `1221ad8707b60f0bd84fc825ffb194bf02a09064afecf6586d493df1cea9e799`.
- Toolchain: Rust `1.98.0`, target `wasm32-wasip1`.

License texts come from the checksum-verified crate archives, supplemented by
pinned upstream sources where the archive omits its license. Identical texts
are deduplicated in the numbered sections of `THIRD_PARTY_LICENSES.txt`.
Where upstream offers alternative licenses, the table identifies the option
used here. Additional embedded-code notices remain applicable.

The sysroot (compiler-provided standard library and native support objects) is
also covered: its 13 registry dependencies are labelled `Rust sysroot` in the
license text, using versions from Rust 1.98.0's `library/Cargo.lock`. Sections
60 onward cover Rust, Unicode data, compiler-builtins/libm, compiler-rt, LLVM
libunwind, WASI libc, and their embedded-code notices; shared texts also appear
in earlier sections. Source comments supplement the project-level licenses.

Rust's source and `wasm32-wasip1` standard-library archives were checked against
the [1.98.0 distribution manifest](https://static.rust-lang.org/dist/channel-rust-1.98.0.toml).
The four native support files match [WASI SDK 33](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-33)
byte-for-byte, as pinned by [Rust's build configuration](https://github.com/rust-lang/rust/blob/1.98.0/src/ci/docker/host-x86_64/dist-various-2/Dockerfile).
Their sources are [WASI libc](https://github.com/WebAssembly/wasi-libc/tree/161b3195fc2558d2b1ba3eb9ffae3b2b47407623)
and [LLVM libunwind](https://github.com/llvm/llvm-project/tree/4434dabb69916856b824f68a64b029c67175e532/libunwind).
This remains a conservative component inventory, not a byte-level link map.
Refresh it when the lockfile, toolchain, target, or artifact changes.

## Source availability

The exact unmodified sources for every crate in the table are available from
its versioned crates.io page, including a source download at
`https://static.crates.io/crates/<name>/<name>-<version>.crate`.

In particular, these MPL-2.0 covered sources remain available under MPL-2.0;
the Overmux license does not restrict recipients' rights to them:

- [colored 3.1.1 source](https://static.crates.io/crates/colored/colored-3.1.1.crate)
- [option-ext 0.2.0 source](https://static.crates.io/crates/option-ext/option-ext-0.2.0.crate)

The full MPL-2.0 terms appear in the referenced license sections below.

## Upstream source supplements

- `include_dir` / `include_dir_macros` 0.7.4: [MIT license at their recorded source revision](https://github.com/Michael-F-Bryan/include_dir/blob/d742c6fffce99ee89da91b934e7ce6fb2a82680c/LICENSE).
- `prost` 0.12.6: [Apache-2.0 license at its recorded source revision](https://github.com/tokio-rs/prost/blob/d42c85e790263f78f6c626ceb0dac5fda0edcb41/LICENSE).
- `zellij-utils` 0.45.1: [Zellij MIT license at its recorded source revision](https://github.com/zellij-org/zellij/blob/efd8fd5a89a20c07a111d248ad7fce53848d2c18/LICENSE.md); includes separate notices for vendored termwiz and common-path code.
- `backtrace-ext` 0.2.1: its [published manifest](https://docs.rs/crate/backtrace-ext/0.2.1/source/Cargo.toml) and [recorded source](https://github.com/Gankra/backtrace-ext/tree/043c95350875a36be6cd755dcef21a44a52ec2cc) declare `MIT OR Apache-2.0` but include no license file. The Apache-2.0 option and its standard full text are included; no copyright holder or year has been invented.
- Rust 1.98.0: [primary MIT license](https://github.com/rust-lang/rust/blob/1.98.0/LICENSE-MIT) and [copyright inventory guidance](https://github.com/rust-lang/rust/blob/1.98.0/COPYRIGHT).

The `minimal-lexical` supplemental notice includes its Go-derived code's BSD
terms conservatively, even though those apply to its optional compact feature.
The `crossbeam-channel` third-party test licenses are not reproduced: crate
tests and benchmarks are not part of this plugin's release build or distribution.

## Cargo dependencies

The final column names sections in `THIRD_PARTY_LICENSES.txt`.

| Crate / source                                                               | Version | License used        | License sections |
| ---------------------------------------------------------------------------- | ------- | ------------------- | ---------------- |
| [addr2line](https://crates.io/crates/addr2line/0.25.1)                       | 0.25.1  | MIT                 | 1                |
| [adler2](https://crates.io/crates/adler2/2.0.1)                              | 2.0.1   | MIT                 | 2                |
| [anstream](https://crates.io/crates/anstream/1.0.0)                          | 1.0.0   | MIT                 | 3                |
| [anstyle](https://crates.io/crates/anstyle/1.0.14)                           | 1.0.14  | MIT                 | 3                |
| [anstyle-parse](https://crates.io/crates/anstyle-parse/1.0.0)                | 1.0.0   | MIT                 | 3                |
| [anstyle-query](https://crates.io/crates/anstyle-query/1.1.5)                | 1.1.5   | MIT                 | 3                |
| [anyhow](https://crates.io/crates/anyhow/1.0.104)                            | 1.0.104 | MIT                 | 2                |
| [backtrace](https://crates.io/crates/backtrace/0.3.76)                       | 0.3.76  | MIT                 | 4                |
| [backtrace-ext](https://crates.io/crates/backtrace-ext/0.2.1)                | 0.2.1   | Apache-2.0          | 5                |
| [bitflags](https://crates.io/crates/bitflags/2.13.1)                         | 2.13.1  | MIT                 | 6                |
| [block-buffer](https://crates.io/crates/block-buffer/0.12.1)                 | 0.12.1  | MIT                 | 7                |
| [bytes](https://crates.io/crates/bytes/1.12.1)                               | 1.12.1  | MIT                 | 8                |
| [cfg-if](https://crates.io/crates/cfg-if/1.0.4)                              | 1.0.4   | MIT                 | 4                |
| [clap](https://crates.io/crates/clap/4.6.6)                                  | 4.6.6   | MIT                 | 3                |
| [clap_builder](https://crates.io/crates/clap_builder/4.6.6)                  | 4.6.6   | MIT                 | 3                |
| [clap_complete](https://crates.io/crates/clap_complete/4.6.9)                | 4.6.9   | MIT                 | 3                |
| [clap_derive](https://crates.io/crates/clap_derive/4.6.4)                    | 4.6.4   | MIT                 | 3                |
| [clap_lex](https://crates.io/crates/clap_lex/1.1.0)                          | 1.1.0   | MIT                 | 3                |
| [colorchoice](https://crates.io/crates/colorchoice/1.0.5)                    | 1.0.5   | MIT                 | 3                |
| [colored](https://crates.io/crates/colored/3.1.1)                            | 3.1.1   | MPL-2.0             | 9                |
| [colorsys](https://crates.io/crates/colorsys/0.6.7)                          | 0.6.7   | MIT                 | 10               |
| [crossbeam](https://crates.io/crates/crossbeam/0.8.4)                        | 0.8.4   | MIT                 | 11               |
| [crossbeam-channel](https://crates.io/crates/crossbeam-channel/0.5.16)       | 0.5.16  | MIT                 | 11               |
| [crossbeam-deque](https://crates.io/crates/crossbeam-deque/0.8.7)            | 0.8.7   | MIT                 | 11               |
| [crossbeam-epoch](https://crates.io/crates/crossbeam-epoch/0.9.20)           | 0.9.20  | MIT                 | 11               |
| [crossbeam-queue](https://crates.io/crates/crossbeam-queue/0.3.13)           | 0.3.13  | MIT                 | 11               |
| [crossbeam-utils](https://crates.io/crates/crossbeam-utils/0.8.22)           | 0.8.22  | MIT                 | 11               |
| [crypto-common](https://crates.io/crates/crypto-common/0.2.2)                | 0.2.2   | MIT                 | 12               |
| [digest](https://crates.io/crates/digest/0.11.3)                             | 0.11.3  | MIT                 | 13               |
| [directories](https://crates.io/crates/directories/6.0.0)                    | 6.0.0   | MIT                 | 14               |
| [dirs](https://crates.io/crates/dirs/6.0.0)                                  | 6.0.0   | MIT                 | 15               |
| [dirs-sys](https://crates.io/crates/dirs-sys/0.5.0)                          | 0.5.0   | MIT                 | 15               |
| [displaydoc](https://crates.io/crates/displaydoc/0.2.7)                      | 0.2.7   | MIT                 | 2                |
| [either](https://crates.io/crates/either/1.18.0)                             | 1.18.0  | MIT                 | 16               |
| [errno](https://crates.io/crates/errno/0.3.14)                               | 0.3.14  | MIT                 | 17               |
| [fastrand](https://crates.io/crates/fastrand/2.5.0)                          | 2.5.0   | MIT                 | 2                |
| [form_urlencoded](https://crates.io/crates/form_urlencoded/1.2.2)            | 1.2.2   | MIT                 | 18               |
| [getrandom](https://crates.io/crates/getrandom/0.4.3)                        | 0.4.3   | MIT                 | 19               |
| [gimli](https://crates.io/crates/gimli/0.32.3)                               | 0.32.3  | MIT                 | 20               |
| [heck](https://crates.io/crates/heck/0.5.0)                                  | 0.5.0   | MIT                 | 20               |
| [hybrid-array](https://crates.io/crates/hybrid-array/0.4.14)                 | 0.4.14  | MIT                 | 21               |
| [icu_collections](https://crates.io/crates/icu_collections/2.3.0)            | 2.3.0   | Unicode-3.0         | 22               |
| [icu_locale_core](https://crates.io/crates/icu_locale_core/2.3.0)            | 2.3.0   | Unicode-3.0         | 22               |
| [icu_normalizer](https://crates.io/crates/icu_normalizer/2.3.0)              | 2.3.0   | Unicode-3.0         | 22               |
| [icu_normalizer_data](https://crates.io/crates/icu_normalizer_data/2.3.0)    | 2.3.0   | Unicode-3.0         | 22               |
| [icu_properties](https://crates.io/crates/icu_properties/2.3.0)              | 2.3.0   | Unicode-3.0         | 22               |
| [icu_properties_data](https://crates.io/crates/icu_properties_data/2.3.0)    | 2.3.0   | Unicode-3.0         | 22               |
| [icu_provider](https://crates.io/crates/icu_provider/2.3.1)                  | 2.3.1   | Unicode-3.0         | 22               |
| [idna](https://crates.io/crates/idna/1.1.0)                                  | 1.1.0   | MIT                 | 23               |
| [idna_adapter](https://crates.io/crates/idna_adapter/1.2.2)                  | 1.2.2   | MIT                 | 24               |
| [include_dir](https://crates.io/crates/include_dir/0.7.4)                    | 0.7.4   | MIT                 | 25               |
| [include_dir_macros](https://crates.io/crates/include_dir_macros/0.7.4)      | 0.7.4   | MIT                 | 25               |
| [is_ci](https://crates.io/crates/is_ci/1.2.0)                                | 1.2.0   | ISC                 | 26               |
| [is_terminal_polyfill](https://crates.io/crates/is_terminal_polyfill/1.70.2) | 1.70.2  | MIT                 | 3                |
| [itertools](https://crates.io/crates/itertools/0.12.1)                       | 0.12.1  | MIT                 | 16               |
| [itoa](https://crates.io/crates/itoa/1.0.18)                                 | 1.0.18  | MIT                 | 2                |
| [kdl](https://crates.io/crates/kdl/4.7.1)                                    | 4.7.1   | Apache-2.0          | 27               |
| [lazy_static](https://crates.io/crates/lazy_static/1.5.0)                    | 1.5.0   | MIT                 | 28               |
| [libc](https://crates.io/crates/libc/0.2.189)                                | 0.2.189 | MIT                 | 29               |
| [litemap](https://crates.io/crates/litemap/0.8.3)                            | 0.8.3   | Unicode-3.0         | 22               |
| [log](https://crates.io/crates/log/0.4.34)                                   | 0.4.34  | MIT                 | 6                |
| [memchr](https://crates.io/crates/memchr/2.8.3)                              | 2.8.3   | MIT                 | 30               |
| [miette](https://crates.io/crates/miette/5.10.0)                             | 5.10.0  | Apache-2.0          | 31               |
| [miette](https://crates.io/crates/miette/7.6.0)                              | 7.6.0   | Apache-2.0          | 31               |
| [miette-derive](https://crates.io/crates/miette-derive/5.10.0)               | 5.10.0  | Apache-2.0          | 27               |
| [miette-derive](https://crates.io/crates/miette-derive/7.6.0)                | 7.6.0   | Apache-2.0          | 27               |
| [minimal-lexical](https://crates.io/crates/minimal-lexical/0.2.1)            | 0.2.1   | MIT                 | 2, 32            |
| [miniz_oxide](https://crates.io/crates/miniz_oxide/0.8.9)                    | 0.8.9   | MIT                 | 33               |
| [nom](https://crates.io/crates/nom/7.1.3)                                    | 7.1.3   | MIT                 | 34               |
| [object](https://crates.io/crates/object/0.37.3)                             | 0.37.3  | MIT                 | 35               |
| [once_cell](https://crates.io/crates/once_cell/1.21.4)                       | 1.21.4  | MIT                 | 2                |
| [option-ext](https://crates.io/crates/option-ext/0.2.0)                      | 0.2.0   | MPL-2.0             | 36               |
| [owo-colors](https://crates.io/crates/owo-colors/4.4.0)                      | 4.4.0   | MIT                 | 37               |
| [percent-encoding](https://crates.io/crates/percent-encoding/2.3.2)          | 2.3.2   | MIT                 | 23               |
| [potential_utf](https://crates.io/crates/potential_utf/0.1.6)                | 0.1.6   | Unicode-3.0         | 22               |
| [proc-macro2](https://crates.io/crates/proc-macro2/1.0.107)                  | 1.0.107 | MIT                 | 2                |
| [prost](https://crates.io/crates/prost/0.12.6)                               | 0.12.6  | Apache-2.0          | 31               |
| [prost-derive](https://crates.io/crates/prost-derive/0.12.6)                 | 0.12.6  | Apache-2.0          | 31               |
| [quote](https://crates.io/crates/quote/1.0.47)                               | 1.0.47  | MIT                 | 2                |
| [rustc-demangle](https://crates.io/crates/rustc-demangle/0.1.28)             | 0.1.28  | MIT                 | 4                |
| [rustix](https://crates.io/crates/rustix/1.1.4)                              | 1.1.4   | MIT                 | 2, 38            |
| [serde](https://crates.io/crates/serde/1.0.229)                              | 1.0.229 | MIT                 | 2                |
| [serde_core](https://crates.io/crates/serde_core/1.0.229)                    | 1.0.229 | MIT                 | 2                |
| [serde_derive](https://crates.io/crates/serde_derive/1.0.229)                | 1.0.229 | MIT                 | 2                |
| [serde_json](https://crates.io/crates/serde_json/1.0.151)                    | 1.0.151 | MIT                 | 2                |
| [sha2](https://crates.io/crates/sha2/0.11.0)                                 | 0.11.0  | MIT                 | 39               |
| [shellexpand](https://crates.io/crates/shellexpand/3.1.2)                    | 3.1.2   | MIT                 | 40               |
| [smallvec](https://crates.io/crates/smallvec/1.15.2)                         | 1.15.2  | MIT                 | 41               |
| [stable_deref_trait](https://crates.io/crates/stable_deref_trait/1.2.1)      | 1.2.1   | MIT                 | 42               |
| [strip-ansi-escapes](https://crates.io/crates/strip-ansi-escapes/0.2.1)      | 0.2.1   | MIT                 | 43               |
| [strsim](https://crates.io/crates/strsim/0.11.1)                             | 0.11.1  | MIT                 | 44               |
| [strum](https://crates.io/crates/strum/0.28.0)                               | 0.28.0  | MIT                 | 45               |
| [strum_macros](https://crates.io/crates/strum_macros/0.28.0)                 | 0.28.0  | MIT                 | 45               |
| [supports-color](https://crates.io/crates/supports-color/3.0.2)              | 3.0.2   | Apache-2.0          | 27               |
| [supports-hyperlinks](https://crates.io/crates/supports-hyperlinks/3.2.0)    | 3.2.0   | Apache-2.0          | 27               |
| [supports-unicode](https://crates.io/crates/supports-unicode/3.0.0)          | 3.0.0   | Apache-2.0          | 27               |
| [syn](https://crates.io/crates/syn/2.0.119)                                  | 2.0.119 | MIT                 | 2                |
| [syn](https://crates.io/crates/syn/3.0.4)                                    | 3.0.4   | MIT                 | 2                |
| [synstructure](https://crates.io/crates/synstructure/0.13.2)                 | 0.13.2  | MIT                 | 46               |
| [tempfile](https://crates.io/crates/tempfile/3.27.0)                         | 3.27.0  | MIT                 | 47               |
| [terminal_size](https://crates.io/crates/terminal_size/0.4.4)                | 0.4.4   | MIT                 | 48               |
| [textwrap](https://crates.io/crates/textwrap/0.16.2)                         | 0.16.2  | MIT                 | 49               |
| [thiserror](https://crates.io/crates/thiserror/1.0.69)                       | 1.0.69  | MIT                 | 2                |
| [thiserror](https://crates.io/crates/thiserror/2.0.20)                       | 2.0.20  | MIT                 | 2                |
| [thiserror-impl](https://crates.io/crates/thiserror-impl/1.0.69)             | 1.0.69  | MIT                 | 2                |
| [thiserror-impl](https://crates.io/crates/thiserror-impl/2.0.20)             | 2.0.20  | MIT                 | 2                |
| [tinystr](https://crates.io/crates/tinystr/0.8.4)                            | 0.8.4   | Unicode-3.0         | 22               |
| [typenum](https://crates.io/crates/typenum/1.20.1)                           | 1.20.1  | MIT                 | 50               |
| [unicode-ident](https://crates.io/crates/unicode-ident/1.0.24)               | 1.0.24  | MIT AND Unicode-3.0 | 2, 51            |
| [unicode-linebreak](https://crates.io/crates/unicode-linebreak/0.1.5)        | 0.1.5   | Apache-2.0          | 31               |
| [unicode-width](https://crates.io/crates/unicode-width/0.1.14)               | 0.1.14  | MIT                 | 20, 52           |
| [unicode-width](https://crates.io/crates/unicode-width/0.2.2)                | 0.2.2   | MIT                 | 20, 52           |
| [url](https://crates.io/crates/url/2.5.8)                                    | 2.5.8   | MIT                 | 23               |
| [utf8_iter](https://crates.io/crates/utf8_iter/1.0.4)                        | 1.0.4   | MIT                 | 53, 54           |
| [utf8parse](https://crates.io/crates/utf8parse/0.2.2)                        | 0.2.2   | MIT                 | 55               |
| [uuid](https://crates.io/crates/uuid/1.26.0)                                 | 1.26.0  | MIT                 | 56               |
| [vte](https://crates.io/crates/vte/0.14.1)                                   | 0.14.1  | MIT                 | 55               |
| [writeable](https://crates.io/crates/writeable/0.6.4)                        | 0.6.4   | Unicode-3.0         | 22               |
| [yoke](https://crates.io/crates/yoke/0.8.3)                                  | 0.8.3   | Unicode-3.0         | 22               |
| [yoke-derive](https://crates.io/crates/yoke-derive/0.8.2)                    | 0.8.2   | Unicode-3.0         | 22               |
| [zellij-tile](https://crates.io/crates/zellij-tile/0.45.1)                   | 0.45.1  | MIT                 | 57               |
| [zellij-utils](https://crates.io/crates/zellij-utils/0.45.1)                 | 0.45.1  | MIT                 | 57, 58, 59       |
| [zerofrom](https://crates.io/crates/zerofrom/0.1.8)                          | 0.1.8   | Unicode-3.0         | 22               |
| [zerofrom-derive](https://crates.io/crates/zerofrom-derive/0.1.7)            | 0.1.7   | Unicode-3.0         | 22               |
| [zerotrie](https://crates.io/crates/zerotrie/0.2.5)                          | 0.2.5   | Unicode-3.0         | 22               |
| [zerovec](https://crates.io/crates/zerovec/0.11.8)                           | 0.11.8  | Unicode-3.0         | 22               |
| [zerovec-derive](https://crates.io/crates/zerovec-derive/0.11.6)             | 0.11.6  | Unicode-3.0         | 22               |
| [zmij](https://crates.io/crates/zmij/1.0.23)                                 | 1.0.23  | MIT                 | 2                |
