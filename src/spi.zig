const std = @import("std");
const mem = std.mem;
const gpiod = @import("gpiod.zig");
const fs = std.fs;
const ioctl = std.os.linux.ioctl;

const Allocator = mem.Allocator;

const DisplayError = error{
    BufferOverflow,
    OutOfBounds,
    SPIDeviceFailInit,
};

// SPI0 RPI3b+
// MOSI/DATA GPIO10 (19)
// SCLK      GPIO11 (23)
// START SPIDEV wrapper from C -  no longer used!
// const spiDev = spi_open("/dev/spidev0.0", config);
pub const SpiConfig = extern struct {
    mode: u8,
    bits_per_word: u8,
    speed: u32,
    delay: u16,
};
extern "c" fn spi_open(device: [*c]const u8, config: ?*SpiConfig) c_int;
extern "c" fn spi_close(fd: c_int) c_int;
extern "c" fn spi_xfer(fd: c_int, txBuf: [*c]u8, len: c_int, rxBuf: [*c]u8, len: c_int) c_int;
extern "c" fn spi_send(fd: c_int, txBuf: [*c]const u8, len: c_int) void;

// SPI message struct

const SPI_IOC_MAGIC = "k";
const SPI_CPHA = 0x01;
const SPI_CPOL = 0x02;

const SPI_MODE_0 = 0;
const SPI_MODE_1 = SPI_CPHA;
const SPI_MODE_2 = SPI_CPOL;
const SPI_MODE_3 = SPI_CPOL | SPI_CPHA;

const SPI_CS_HIGH = 0x04;
const SPI_LSB_FIRST = 0x08;
const SPI_3WIRE = 0x10;
const SPI_LOOP = 0x20;
const SPI_NO_CS = 0x40;
const SPI_READY = 0x80;
const SPI_TX_DUAL = 0x100;
const SPI_TX_QUAD = 0x200;
const SPI_RX_DUAL = 0x400;
const SPI_RX_QUAD = 0x800;

const SPI_IOC_MESSAGE_BASE = 0x40006b00;
const SPI_IOC_MESSAGE_INCR = 0x200000;

// Read / Write of SPI mode (SPI_MODE_0..SPI_MODE_3) (limited to 8 bits);
const SPI_IOC_RD_MODE = 0x80016b01;
const SPI_IOC_WR_MODE = 0x40016b01;

// Read / Write SPI bit justification;
const SPI_IOC_RD_LSB_FIRST = 0x80016b02;
const SPI_IOC_WR_LSB_FIRST = 0x40016b02;

// Read / Write SPI device word length (1..N);
const SPI_IOC_RD_BITS_PER_WORD = 0x80016b03;
const SPI_IOC_WR_BITS_PER_WORD = 0x40016b03;

// Read / Write SPI device default max speed Hz;
const SPI_IOC_RD_MAX_SPEED_HZ = 0x80046b04;
const SPI_IOC_WR_MAX_SPEED_HZ = 0x40046b04;

// Read / Write of the SPI mode field;
const SPI_IOC_RD_MODE32 = 0x80046b05;
const SPI_IOC_WR_MODE32 = 0x40046b05;

pub const SpiTransfer = struct {
    tx_buf: ?[*]const u8,
    rx_buf: ?[*]u8 = null,
    len: u32,
    speed_hz: u32 = 2_400_000,
    delay_usecs: u16 = 0,
    bits_per_word: u8 = 8,
};

const SpiIocTransfer = extern struct {
    tx_buf: u64,
    rx_buf: u64,
    len: u32,
    speed_hz: u32,
    delay_usecs: u16,
    bits_per_word: u8,
    cs_change: u8 = 0,
    pad: u32 = 0,
};

fn SPI_IOC_MESSAGE(n: u32) u32 {
    return (1 << 30) | (107 << 8) | n;
}

// SPI Device struct
pub const SPIDevice = struct {
    fd: fs.File, // file descriptor
    speedHz: u32, // SPI speed in Hz
    csChange: u8, // Chip select pin
    mode: u32,
    bitsPerWord: u8,
    delayUsecs: u16,
};

pub const Bus = struct {
    const Self = @This();

    config: ?*SpiConfig,
    fd: std.Io.File,                // need handle for deinit closing
    writer: std.Io.File.Writer,     // NOT pointer, it will be destroyed
    io: std.Io,
    chip: ?*gpiod.struct_gpiod_chip,
    lines: ?*gpiod.struct_gpiod_line_request,
    dcPin: u32,
    rstPin: u32,
    dcActive: bool = false, // cached DC line state; line starts INACTIVE (0) in init
    //csPin: u32,

    pub fn init(allocator: Allocator, config: *SpiConfig, chp: ?*gpiod.struct_gpiod_chip, dcPin: u32, rstPin: u32) !Self {
        std.debug.print("Opening SPI BUS\n", .{});
        // init IO backend for spidev writer
        var threaded = std.Io.Threaded.init(allocator, .{});
        const io = threaded.io();
        defer threaded.deinit();
        const fd = std.Io.Dir.openFileAbsolute(io, "/dev/spidev0.0", .{.mode = .read_write }) catch |err| {
            std.debug.print("failed opening spidev for Control!\n", .{});
            return err;
        };
        const file_writer = std.Io.File.Writer.init(fd, io, &.{});

        // UNUSED : using c wrapper
        //const spiDev = spi_open("/dev/spidev0.0", config);
        //std.debug.print("SPI BUS handle {d}\n", .{spiDev});

        // Configure SPI
        const res = ioctl(fd.handle, SPI_IOC_WR_MODE, @intFromPtr(&config.mode));
        if (res != 0) {
            std.debug.print("fd err {d} {any}\n", .{res, config.mode});
        }
        _ = ioctl(fd.handle, SPI_IOC_WR_BITS_PER_WORD, @intFromPtr(&config.bits_per_word));
        _ = ioctl(fd.handle, SPI_IOC_WR_MAX_SPEED_HZ, @intFromPtr(&config.speed));

        const offsets: [2]u32 = .{ dcPin, rstPin };
        std.debug.print("CHIP! {any}\n", .{chp});
        const settings = gpiod.gpiod_line_settings_new();
        _ = gpiod.gpiod_line_settings_set_direction(settings, gpiod.GPIOD_LINE_DIRECTION_OUTPUT);
        _ = gpiod.gpiod_line_settings_set_output_value(settings, gpiod.GPIOD_LINE_VALUE_INACTIVE);

        const line_cfg = gpiod.gpiod_line_config_new();
        _ = gpiod.gpiod_line_config_add_line_settings(line_cfg, &offsets[0], 2, settings);
        const req_cfg = gpiod.gpiod_request_config_new();
        _= gpiod.gpiod_request_config_set_consumer(req_cfg, "spi_zig");
        const lines = gpiod.gpiod_chip_request_lines(chp, req_cfg, line_cfg);

        return Self{
            .config = config,
            .fd = fd,
            .writer = file_writer,
            .io = io,
            .chip = chp,
            .lines = lines,
            .dcPin = dcPin,
            .rstPin = rstPin,
            //.csPin = csPin,
        };
    }

    // configure configures some pins with the SPI bus ( RESET )
    pub fn configure(self: *Self) !void {

        std.debug.print("spi reset\n", .{});
        // 0: dcPin, 1: rstPin:,  2: csPin
        _ = gpiod.gpiod_line_request_set_value(self.lines, self.rstPin, gpiod.GPIOD_LINE_VALUE_INACTIVE);
        try self.io.sleep(std.Io.Duration.fromMilliseconds(10), .real); // 10ms
        _ = gpiod.gpiod_line_request_set_value(self.lines, self.rstPin, gpiod.GPIOD_LINE_VALUE_ACTIVE);
        try self.io.sleep(std.Io.Duration.fromMilliseconds(10), .real); // 10ms
    }

    pub fn spiXfer(self: *Self, buf: []const u8, isData: bool) !void {
        if (isData) {
            self.dcToggle(true);
        } else {
            self.dcToggle(false);
        }
        self.writer.interface.writeAll(buf) catch |err| {
            // Dette vil printe f.eks. "error.InvalidArgument" eller "error.SystemResources"
            std.debug.print("SPI WRITE ERROR: {any}\n", .{err});
            return err;
        };
        self.writer.interface.flush() catch |err| {
            // Dette vil printe f.eks. "error.InvalidArgument" eller "error.SystemResources"
            std.debug.print("SPI FLUSH ERROR: {any}\n", .{err});
            return err;
        };
    }

    pub fn dcToggle(self: *Self, hilo: bool) void {
        // Each toggle is a gpiod ioctl; skip it when the level is unchanged
        if (self.dcActive == hilo) return;
        self.dcActive = hilo;
        if (hilo == true) {
            _ = gpiod.gpiod_line_request_set_value(self.lines, self.dcPin, gpiod.GPIOD_LINE_VALUE_ACTIVE);
            // _ = gpiod.gpiod_line_set_value(self.dcPin, 1);
        } else {
            _ = gpiod.gpiod_line_request_set_value(self.lines, self.dcPin, gpiod.GPIOD_LINE_VALUE_INACTIVE);
            // _ = gpiod.gpiod_line_set_value(self.dcPin, 0);
        }
    }
    pub fn deinit(self: *Self) void {
        _ = gpiod.gpiod_line_request_release(self.lines);
        defer self.fd.close(self.io);
        _ = gpiod.gpiod_chip_close(self.chip);
    }
};
