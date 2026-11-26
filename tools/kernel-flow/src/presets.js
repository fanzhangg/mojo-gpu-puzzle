const PRESETS = [
 {
  "id": "p01",
  "title": "p01 · Map",
  "code": "comptime SIZE = 4\ncomptime BLOCKS_PER_GRID = 1\ncomptime THREADS_PER_BLOCK = SIZE\ncomptime dtype = DType.float32\n\ndef add_10(\n    output: Pointer[Scalar[dtype], MutAnyOrigin],\n    a: Pointer[Scalar[dtype], MutAnyOrigin],\n):\n    var i = thread_idx.x\n    output[unsafe_offset=i] = a[unsafe_offset=i] + 10.0\n",
  "launch": "grid  = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\noutput = zeros(SIZE)\na = arange(SIZE)\nexpect output = arange(SIZE) + 10"
 },
 {
  "id": "p02",
  "title": "p02 · Zip",
  "code": "comptime SIZE = 4\ncomptime BLOCKS_PER_GRID = 1\ncomptime THREADS_PER_BLOCK = SIZE\ncomptime dtype = DType.float32\n\ndef add(\n    output: Pointer[Scalar[dtype], MutAnyOrigin],\n    a: Pointer[Scalar[dtype], MutAnyOrigin],\n    b: Pointer[Scalar[dtype], MutAnyOrigin],\n):\n    var i = thread_idx.x\n    output[unsafe_offset=i] = a[unsafe_offset=i] + b[unsafe_offset=i]\n",
  "launch": "grid  = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\noutput = zeros(SIZE)\na = arange(SIZE)\nb = arange(SIZE)\nexpect output = a + b"
 },
 {
  "id": "p03",
  "title": "p03 · Guards",
  "code": "comptime SIZE = 4\ncomptime BLOCKS_PER_GRID = 1\ncomptime THREADS_PER_BLOCK = 8\ncomptime dtype = DType.float32\n\ndef add_10_guard(\n    output: Pointer[Scalar[dtype], MutAnyOrigin],\n    a: Pointer[Scalar[dtype], MutAnyOrigin],\n    size_dev: Int32,\n):\n    var size = Int(size_dev)\n    var i = thread_idx.x\n    if i < size:\n        output[unsafe_offset=i] = a[unsafe_offset=i] + 10.0\n",
  "launch": "grid  = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\noutput = zeros(SIZE)\na = arange(SIZE)\nsize_dev = SIZE\nexpect output = arange(SIZE) + 10"
 },
 {
  "id": "p04",
  "title": "p04 · 2D map",
  "code": "comptime SIZE = 2\ncomptime BLOCKS_PER_GRID = 1\ncomptime THREADS_PER_BLOCK = (3, 3)\ncomptime dtype = DType.float32\n\ndef add_10_2d(\n    output: Pointer[Scalar[dtype], MutAnyOrigin],\n    a: Pointer[Scalar[dtype], MutAnyOrigin],\n    size_dev: Int32,\n):\n    var size = Int(size_dev)\n    var row = thread_idx.y\n    var col = thread_idx.x\n    var idx = row * size + col\n    if row < size and col < size:\n        output[unsafe_offset=idx] = a[unsafe_offset=idx] + 10.0\n",
  "launch": "grid  = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\noutput = zeros(SIZE * SIZE)\na = arange(SIZE * SIZE)\nsize_dev = SIZE\nexpect output = arange(SIZE * SIZE) + 10"
 },
 {
  "id": "p04t",
  "title": "p04 · 2D map (TileTensor)",
  "code": "comptime SIZE = 2\ncomptime BLOCKS_PER_GRID = 1\ncomptime THREADS_PER_BLOCK = (3, 3)\ncomptime dtype = DType.float32\ncomptime layout = row_major[SIZE, SIZE]()\ncomptime LayoutType = type_of(layout)\n\ndef add_10_2d(\n    output: TileTensor[mut=True, dtype, LayoutType, MutAnyOrigin],\n    a: TileTensor[mut=True, dtype, LayoutType, MutAnyOrigin],\n    size_dev: Int32,\n):\n    var size = Int(size_dev)\n    var row = thread_idx.y\n    var col = thread_idx.x\n    \n    if row < size and col < size:\n        output[row, col] = a[row, col] + 10.0\n",
  "launch": "grid  = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\noutput = zeros(SIZE * SIZE)\na = arange(SIZE * SIZE)\nsize_dev = SIZE\nexpect output = arange(SIZE * SIZE) + 10"
 },
 {
  "id": "p05",
  "title": "p05 · Broadcast",
  "code": "comptime SIZE = 2\ncomptime BLOCKS_PER_GRID = 1\ncomptime THREADS_PER_BLOCK = (3, 3)\ncomptime dtype = DType.float32\ncomptime out_layout = row_major[SIZE, SIZE]()\ncomptime a_layout = row_major[1, SIZE]()\ncomptime b_layout = row_major[SIZE, 1]()\ncomptime OutLayout = type_of(out_layout)\ncomptime ALayout = type_of(a_layout)\ncomptime BLayout = type_of(b_layout)\n\ndef broadcast_add[\n    Engine: TensorEngine,\n](\n    output: TileTensor[mut=True, dtype, OutLayout, MutAnyOrigin, Engine=Engine],\n    a: TileTensor[mut=False, dtype, ALayout, ImmutAnyOrigin, Engine=Engine],\n    b: TileTensor[mut=False, dtype, BLayout, ImmutAnyOrigin, Engine=Engine],\n    size_dev: Int32,\n) where (Engine.element_size == 1):\n    var size = Int(size_dev)\n    var row = thread_idx.y\n    var col = thread_idx.x\n    if row < size and col < size:\n        output[row, col] = a[0, col] + b[row, 0]\n",
  "launch": "grid  = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\noutput = zeros(SIZE * SIZE)\na = arange(SIZE) + 1\nb = arange(SIZE) * 10\nsize_dev = SIZE\nexpect output = [1, 2, 11, 12]"
 },
 {
  "id": "p06",
  "title": "p06 · Blocks",
  "code": "comptime SIZE = 9\ncomptime BLOCKS_PER_GRID = (3, 1)\ncomptime THREADS_PER_BLOCK = (4, 1)\ncomptime dtype = DType.float32\n\ndef add_10_blocks(\n    output: Pointer[Scalar[dtype], MutAnyOrigin],\n    a: Pointer[Scalar[dtype], MutAnyOrigin],\n    size_dev: Int32,\n):\n    var size = Int(size_dev)\n    var i = block_dim.x * block_idx.x + thread_idx.x\n    if i < size:\n        output[unsafe_offset=i] = a[unsafe_offset=i] + 10.0\n",
  "launch": "grid  = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\noutput = zeros(SIZE)\na = arange(SIZE)\nsize_dev = SIZE\nexpect output = arange(SIZE) + 10"
 },
 {
  "id": "p07",
  "title": "p07 · 2D blocks",
  "code": "comptime SIZE = 5\ncomptime BLOCKS_PER_GRID = (2, 2)\ncomptime THREADS_PER_BLOCK = (3, 3)\ncomptime dtype = DType.float32\ncomptime out_layout = row_major[SIZE, SIZE]()\ncomptime a_layout = row_major[SIZE, SIZE]()\ncomptime OutLayout = type_of(out_layout)\ncomptime ALayout = type_of(a_layout)\n\ndef add_10_blocks_2d[\n    Engine: TensorEngine,\n](\n    output: TileTensor[mut=True, dtype, OutLayout, MutAnyOrigin, Engine=Engine],\n    a: TileTensor[mut=False, dtype, ALayout, ImmutAnyOrigin, Engine=Engine],\n    size_dev: Int32,\n) where (Engine.element_size == 1):\n    var size = Int(size_dev)\n    var row = block_dim.y * block_idx.y + thread_idx.y\n    var col = block_dim.x * block_idx.x + thread_idx.x\n    if row < size and col < size:\n        output[row, col] = a[row, col] + 10.0\n",
  "launch": "grid  = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\noutput = zeros(SIZE * SIZE)\na = arange(SIZE * SIZE)\nsize_dev = SIZE\nexpect output = arange(SIZE * SIZE) + 10"
 },
 {
  "id": "p08",
  "title": "p08 · Shared memory",
  "code": "comptime TPB = 4\ncomptime SIZE = 8\ncomptime BLOCKS_PER_GRID = (2, 1)\ncomptime THREADS_PER_BLOCK = (TPB, 1)\ncomptime dtype = DType.float32\ncomptime layout = row_major[SIZE]()\ncomptime LayoutType = type_of(layout)\n\ndef add_10_shared_tile_tensor[\n    Engine: TensorEngine,\n](\n    output: TileTensor[\n        mut=True, dtype, LayoutType, MutAnyOrigin, Engine=Engine\n    ],\n    a: TileTensor[mut=False, dtype, LayoutType, ImmutAnyOrigin, Engine=Engine],\n    size_dev: Int32,\n) where (Engine.element_size == 1):\n    var size = Int(size_dev)\n    # Allocate shared memory. Unlike most kernel variables, which are private to\n    # each thread, shared memory (`AddressSpace.SHARED`) is scoped per-block.\n    # So, each thread in a block can use the same \"scratchpad\" to store data.\n    var shared = stack_allocation[dtype=dtype, address_space=.SHARED](\n        row_major[TPB]()\n    )\n\n    var global_i = block_dim.x * block_idx.x + thread_idx.x\n    var local_i = thread_idx.x\n\n    if global_i < size:\n        shared[local_i] = rebind[Scalar[dtype]](a[global_i])\n\n    # Note: barrier is not strictly needed here since each thread only accesses\n    # its own shared memory location. However, it's included to teach proper\n    # shared memory synchronization patterns for more complex scenarios where\n    # threads need to coordinate access to shared data.\n    barrier()\n\n    if global_i < size:\n        output[global_i] = shared[local_i] + 10.0\n",
  "launch": "grid  = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\noutput = zeros(SIZE)\na = ones(SIZE)\nsize_dev = SIZE\nexpect output = fill(SIZE, 11)"
 },
 {
  "id": "bug-guard",
  "title": "Demo · p03 without a guard",
  "code": "comptime SIZE = 4\ncomptime BLOCKS_PER_GRID = 1\ncomptime THREADS_PER_BLOCK = 8\ncomptime dtype = DType.float32\n\ndef add_10_guard(\n    output: Pointer[Scalar[dtype], MutAnyOrigin],\n    a: Pointer[Scalar[dtype], MutAnyOrigin],\n    size_dev: Int32,\n):\n    var size = Int(size_dev)\n    var i = thread_idx.x\n    output[unsafe_offset=i] = a[unsafe_offset=i] + 10.0\n",
  "launch": "grid  = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\noutput = zeros(SIZE)\na = arange(SIZE)\nsize_dev = SIZE\nexpect output = arange(SIZE) + 10"
 },
 {
  "id": "bug-race",
  "title": "Demo · neighbour read, no barrier",
  "code": "comptime TPB = 4\ncomptime SIZE = 8\ncomptime BLOCKS_PER_GRID = (2, 1)\ncomptime THREADS_PER_BLOCK = (TPB, 1)\ncomptime dtype = DType.float32\ncomptime layout = row_major[SIZE]()\ncomptime LayoutType = type_of(layout)\n\n\n# Each thread reads its right neighbour's shared slot.\n# Toggle the barrier() line to see the race appear and disappear.\ndef rotate_shared[\n    Engine: TensorEngine,\n](\n    output: TileTensor[mut=True, dtype, LayoutType, MutAnyOrigin, Engine=Engine],\n    a: TileTensor[mut=False, dtype, LayoutType, ImmutAnyOrigin, Engine=Engine],\n    size_dev: Int32,\n) where (Engine.element_size == 1):\n    var size = Int(size_dev)\n    var shared = stack_allocation[dtype=dtype, address_space=.SHARED](\n        row_major[TPB]()\n    )\n    var global_i = block_dim.x * block_idx.x + thread_idx.x\n    var local_i = thread_idx.x\n    if global_i < size:\n        shared[local_i] = a[global_i] * 2.0\n    # barrier()\n    if global_i < size:\n        var neighbour = (local_i + 1) % TPB\n        output[global_i] = shared[neighbour]\n",
  "launch": "grid  = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\noutput = zeros(SIZE)\na = arange(SIZE)\nsize_dev = SIZE\nexpect output = [2, 4, 6, 0, 10, 12, 14, 8]"
 }
];
if (typeof module !== "undefined") module.exports = PRESETS;
