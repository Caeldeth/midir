// Passive packet capture and TCP-table lookup for Midir.
//
// The addon never sends a packet and never writes to another process. It reads
// frames off an adapter through Npcap and reads the operating system's own TCP
// table. Both are read-only operations.
//
// wpcap.dll is loaded at run time with LoadLibrary, so the build needs no Npcap
// SDK. The pcap structures and function signatures below are declared here to
// match the stable libpcap ABI.

#include <napi.h>

#ifdef _WIN32

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <iphlpapi.h>
#include <tlhelp32.h>

#include <atomic>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

// ---------------------------------------------------------------------------
// The part of the libpcap ABI this addon uses
// ---------------------------------------------------------------------------

typedef struct pcap pcap_t;
typedef unsigned int bpf_u_int32;

struct pcap_addr_t {
  struct pcap_addr_t* next;
  struct sockaddr* addr;
  struct sockaddr* netmask;
  struct sockaddr* broadaddr;
  struct sockaddr* dstaddr;
};

struct pcap_if_t {
  struct pcap_if_t* next;
  char* name;
  char* description;
  struct pcap_addr_t* addresses;
  bpf_u_int32 flags;
};

struct pcap_pkthdr {
  struct timeval ts;
  bpf_u_int32 caplen;
  bpf_u_int32 len;
};

struct bpf_program {
  unsigned int bf_len;
  void* bf_insns;
};

typedef int(__cdecl* fn_findalldevs)(pcap_if_t**, char*);
typedef void(__cdecl* fn_freealldevs)(pcap_if_t*);
typedef pcap_t*(__cdecl* fn_open_live)(const char*, int, int, int, char*);
typedef void(__cdecl* fn_close)(pcap_t*);
typedef int(__cdecl* fn_compile)(pcap_t*, bpf_program*, const char*, int, bpf_u_int32);
typedef int(__cdecl* fn_setfilter)(pcap_t*, bpf_program*);
typedef void(__cdecl* fn_freecode)(bpf_program*);
typedef int(__cdecl* fn_next_ex)(pcap_t*, pcap_pkthdr**, const unsigned char**);
typedef void(__cdecl* fn_breakloop)(pcap_t*);
typedef int(__cdecl* fn_datalink)(pcap_t*);
typedef char*(__cdecl* fn_geterr)(pcap_t*);

struct PcapApi {
  HMODULE module = nullptr;
  fn_findalldevs findalldevs = nullptr;
  fn_freealldevs freealldevs = nullptr;
  fn_open_live open_live = nullptr;
  fn_close close = nullptr;
  fn_compile compile = nullptr;
  fn_setfilter setfilter = nullptr;
  fn_freecode freecode = nullptr;
  fn_next_ex next_ex = nullptr;
  fn_breakloop breakloop = nullptr;
  fn_datalink datalink = nullptr;
  fn_geterr geterr = nullptr;
  std::string loadError;

  bool ok() const { return module != nullptr; }
};

static PcapApi g_pcap;
static std::once_flag g_pcapOnce;

template <typename T>
static bool resolve(HMODULE module, const char* name, T& slot) {
  slot = reinterpret_cast<T>(GetProcAddress(module, name));
  return slot != nullptr;
}

// Npcap installs wpcap.dll under System32\Npcap. Its WinPcap-compatible mode
// also places a copy directly in System32. Load the Npcap copy by full path
// first, with the altered search path so its sibling Packet.dll is found.
static void loadPcap() {
  char systemDir[MAX_PATH] = {0};
  if (GetSystemDirectoryA(systemDir, MAX_PATH) > 0) {
    std::string npcap = std::string(systemDir) + "\\Npcap\\wpcap.dll";
    g_pcap.module = LoadLibraryExA(npcap.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
  }
  if (g_pcap.module == nullptr) g_pcap.module = LoadLibraryA("wpcap.dll");

  if (g_pcap.module == nullptr) {
    g_pcap.loadError =
        "wpcap.dll could not be loaded. Install Npcap in WinPcap API-compatible mode.";
    return;
  }

  const bool complete = resolve(g_pcap.module, "pcap_findalldevs", g_pcap.findalldevs) &&
                        resolve(g_pcap.module, "pcap_freealldevs", g_pcap.freealldevs) &&
                        resolve(g_pcap.module, "pcap_open_live", g_pcap.open_live) &&
                        resolve(g_pcap.module, "pcap_close", g_pcap.close) &&
                        resolve(g_pcap.module, "pcap_compile", g_pcap.compile) &&
                        resolve(g_pcap.module, "pcap_setfilter", g_pcap.setfilter) &&
                        resolve(g_pcap.module, "pcap_freecode", g_pcap.freecode) &&
                        resolve(g_pcap.module, "pcap_next_ex", g_pcap.next_ex) &&
                        resolve(g_pcap.module, "pcap_breakloop", g_pcap.breakloop) &&
                        resolve(g_pcap.module, "pcap_datalink", g_pcap.datalink) &&
                        resolve(g_pcap.module, "pcap_geterr", g_pcap.geterr);

  if (!complete) {
    FreeLibrary(g_pcap.module);
    g_pcap.module = nullptr;
    g_pcap.loadError = "wpcap.dll loaded but is missing an expected export.";
  }
}

static PcapApi& pcap() {
  std::call_once(g_pcapOnce, loadPcap);
  return g_pcap;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static std::string formatAddress(const struct sockaddr* address) {
  if (address == nullptr) return "";
  char text[INET6_ADDRSTRLEN] = {0};
  if (address->sa_family == AF_INET) {
    const auto* v4 = reinterpret_cast<const struct sockaddr_in*>(address);
    if (inet_ntop(AF_INET, &v4->sin_addr, text, sizeof(text)) != nullptr) return text;
  } else if (address->sa_family == AF_INET6) {
    const auto* v6 = reinterpret_cast<const struct sockaddr_in6*>(address);
    if (inet_ntop(AF_INET6, &v6->sin6_addr, text, sizeof(text)) != nullptr) return text;
  }
  return "";
}

static std::wstring utf8ToWide(const std::string& text) {
  if (text.empty()) return std::wstring();
  const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()),
                                       nullptr, 0);
  std::wstring wide(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), wide.data(), size);
  return wide;
}

static std::wstring toLowerWide(std::wstring text) {
  for (wchar_t& c : text) c = static_cast<wchar_t>(towlower(c));
  return text;
}

static std::string ipv4ToString(DWORD address) {
  const auto* octets = reinterpret_cast<const unsigned char*>(&address);
  char text[16] = {0};
  sprintf_s(text, sizeof(text), "%u.%u.%u.%u", octets[0], octets[1], octets[2], octets[3]);
  return text;
}

// MIB_TCPROW_OWNER_PID holds ports in network byte order in the low 16 bits.
static unsigned short portOf(DWORD port) {
  return static_cast<unsigned short>(ntohs(static_cast<unsigned short>(port & 0xffff)));
}

// ---------------------------------------------------------------------------
// isAvailable()
// ---------------------------------------------------------------------------

static Napi::Value IsAvailable(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), pcap().ok());
}

static Napi::Value LoadError(const Napi::CallbackInfo& info) {
  PcapApi& api = pcap();
  if (api.ok()) return info.Env().Null();
  return Napi::String::New(info.Env(), api.loadError);
}

// ---------------------------------------------------------------------------
// listDevices()
// ---------------------------------------------------------------------------

static Napi::Value ListDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  PcapApi& api = pcap();
  if (!api.ok()) {
    Napi::Error::New(env, api.loadError).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  char errbuf[256] = {0};
  pcap_if_t* devices = nullptr;
  if (api.findalldevs(&devices, errbuf) != 0) {
    Napi::Error::New(env, std::string("pcap_findalldevs failed: ") + errbuf)
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Array result = Napi::Array::New(env);
  uint32_t index = 0;
  for (pcap_if_t* device = devices; device != nullptr; device = device->next) {
    Napi::Object entry = Napi::Object::New(env);
    entry.Set("name", Napi::String::New(env, device->name ? device->name : ""));
    entry.Set("description",
              Napi::String::New(env, device->description ? device->description : ""));
    entry.Set("loopback", Napi::Boolean::New(env, (device->flags & 0x00000001) != 0));

    Napi::Array addresses = Napi::Array::New(env);
    uint32_t addressIndex = 0;
    for (pcap_addr_t* a = device->addresses; a != nullptr; a = a->next) {
      const std::string address = formatAddress(a->addr);
      if (address.empty()) continue;
      Napi::Object item = Napi::Object::New(env);
      item.Set("address", Napi::String::New(env, address));
      item.Set("netmask", Napi::String::New(env, formatAddress(a->netmask)));
      addresses.Set(addressIndex++, item);
    }
    entry.Set("addresses", addresses);
    result.Set(index++, entry);
  }

  api.freealldevs(devices);
  return result;
}

// ---------------------------------------------------------------------------
// startCapture() / stopCapture()
// ---------------------------------------------------------------------------

struct CapturedPacket {
  double timestampMs;
  std::vector<unsigned char> bytes;
};

struct CaptureSession {
  pcap_t* handle = nullptr;
  std::thread worker;
  std::atomic<bool> running{false};
  Napi::ThreadSafeFunction callback;
  int datalink = 0;
};

static std::mutex g_sessionsMutex;
static std::map<int32_t, std::shared_ptr<CaptureSession>> g_sessions;
static int32_t g_nextSessionId = 1;

// How many packets to gather before crossing into JavaScript. A read timeout
// flushes a short batch, so latency stays low on a quiet link.
static const size_t kBatchSize = 64;
static const int kReadTimeoutMs = 100;
static const int kSnapLength = 65535;

static void deliver(Napi::ThreadSafeFunction& callback,
                    std::shared_ptr<std::vector<CapturedPacket>> batch) {
  if (batch->empty()) return;
  callback.BlockingCall(batch.get(), [batch](Napi::Env env, Napi::Function jsCallback,
                                             std::vector<CapturedPacket>* packets) {
    Napi::Array array = Napi::Array::New(env, packets->size());
    for (size_t i = 0; i < packets->size(); i++) {
      const CapturedPacket& packet = (*packets)[i];
      Napi::Object entry = Napi::Object::New(env);
      entry.Set("timestampMs", Napi::Number::New(env, packet.timestampMs));
      entry.Set("bytes", Napi::Buffer<unsigned char>::Copy(env, packet.bytes.data(),
                                                           packet.bytes.size()));
      array.Set(static_cast<uint32_t>(i), entry);
    }
    jsCallback.Call({array});
  });
}

static void captureLoop(std::shared_ptr<CaptureSession> session) {
  PcapApi& api = g_pcap;
  auto batch = std::make_shared<std::vector<CapturedPacket>>();
  batch->reserve(kBatchSize);

  while (session->running.load()) {
    pcap_pkthdr* header = nullptr;
    const unsigned char* data = nullptr;
    const int status = api.next_ex(session->handle, &header, &data);

    if (status == 1 && header != nullptr && data != nullptr) {
      CapturedPacket packet;
      packet.timestampMs = static_cast<double>(header->ts.tv_sec) * 1000.0 +
                           static_cast<double>(header->ts.tv_usec) / 1000.0;
      packet.bytes.assign(data, data + header->caplen);
      batch->push_back(std::move(packet));
      if (batch->size() >= kBatchSize) {
        deliver(session->callback, batch);
        batch = std::make_shared<std::vector<CapturedPacket>>();
        batch->reserve(kBatchSize);
      }
      continue;
    }

    // 0 is a read timeout, which is the normal quiet-link case. Anything below
    // 0 means the handle was broken or pcap_breakloop was called.
    if (!batch->empty()) {
      deliver(session->callback, batch);
      batch = std::make_shared<std::vector<CapturedPacket>>();
      batch->reserve(kBatchSize);
    }
    if (status < 0) break;
  }

  deliver(session->callback, batch);
  session->callback.Release();
}

// startCapture({ device, filter }, onBatch) -> { id, datalink }
static Napi::Value StartCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  PcapApi& api = pcap();
  if (!api.ok()) {
    Napi::Error::New(env, api.loadError).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "startCapture(options, onBatch) expects an object and a function")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Object options = info[0].As<Napi::Object>();
  const std::string device = options.Get("device").As<Napi::String>().Utf8Value();
  const std::string filter = options.Has("filter")
                                 ? options.Get("filter").As<Napi::String>().Utf8Value()
                                 : std::string();

  char errbuf[256] = {0};
  // promisc = 0. Midir wants this machine's own traffic, nothing else.
  pcap_t* handle = api.open_live(device.c_str(), kSnapLength, 0, kReadTimeoutMs, errbuf);
  if (handle == nullptr) {
    Napi::Error::New(env, std::string("pcap_open_live failed: ") + errbuf)
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!filter.empty()) {
    bpf_program program = {};
    if (api.compile(handle, &program, filter.c_str(), 1, 0xffffffff) != 0) {
      const std::string message = std::string("pcap_compile failed: ") + api.geterr(handle);
      api.close(handle);
      Napi::Error::New(env, message).ThrowAsJavaScriptException();
      return env.Undefined();
    }
    const int applied = api.setfilter(handle, &program);
    api.freecode(&program);
    if (applied != 0) {
      const std::string message = std::string("pcap_setfilter failed: ") + api.geterr(handle);
      api.close(handle);
      Napi::Error::New(env, message).ThrowAsJavaScriptException();
      return env.Undefined();
    }
  }

  auto session = std::make_shared<CaptureSession>();
  session->handle = handle;
  session->datalink = api.datalink(handle);
  session->running.store(true);
  session->callback = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(),
                                                    "da-pcap capture", 0, 1);

  int32_t id;
  {
    std::lock_guard<std::mutex> lock(g_sessionsMutex);
    id = g_nextSessionId++;
    g_sessions[id] = session;
  }
  session->worker = std::thread(captureLoop, session);

  Napi::Object result = Napi::Object::New(env);
  result.Set("id", Napi::Number::New(env, id));
  result.Set("datalink", Napi::Number::New(env, session->datalink));
  return result;
}

static Napi::Value StopCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "stopCapture(id) expects a number").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const int32_t id = info[0].As<Napi::Number>().Int32Value();
  std::shared_ptr<CaptureSession> session;
  {
    std::lock_guard<std::mutex> lock(g_sessionsMutex);
    auto found = g_sessions.find(id);
    if (found == g_sessions.end()) return Napi::Boolean::New(env, false);
    session = found->second;
    g_sessions.erase(found);
  }

  session->running.store(false);
  if (g_pcap.ok() && session->handle != nullptr) g_pcap.breakloop(session->handle);
  if (session->worker.joinable()) session->worker.join();
  if (g_pcap.ok() && session->handle != nullptr) g_pcap.close(session->handle);
  session->handle = nullptr;
  return Napi::Boolean::New(env, true);
}

// ---------------------------------------------------------------------------
// tcpConnectionsForPid()
// ---------------------------------------------------------------------------

static Napi::Value TcpConnectionsForPid(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "tcpConnectionsForPid(pid) expects a number")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const DWORD wanted = static_cast<DWORD>(info[0].As<Napi::Number>().Uint32Value());

  DWORD size = 0;
  GetExtendedTcpTable(nullptr, &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);
  std::vector<unsigned char> buffer(size);
  if (GetExtendedTcpTable(buffer.data(), &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0) !=
      NO_ERROR) {
    Napi::Error::New(env, "GetExtendedTcpTable failed").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const auto* table = reinterpret_cast<const MIB_TCPTABLE_OWNER_PID*>(buffer.data());
  Napi::Array result = Napi::Array::New(env);
  uint32_t index = 0;
  for (DWORD i = 0; i < table->dwNumEntries; i++) {
    const MIB_TCPROW_OWNER_PID& row = table->table[i];
    if (row.dwOwningPid != wanted) continue;
    Napi::Object entry = Napi::Object::New(env);
    entry.Set("localAddress", Napi::String::New(env, ipv4ToString(row.dwLocalAddr)));
    entry.Set("localPort", Napi::Number::New(env, portOf(row.dwLocalPort)));
    entry.Set("remoteAddress", Napi::String::New(env, ipv4ToString(row.dwRemoteAddr)));
    entry.Set("remotePort", Napi::Number::New(env, portOf(row.dwRemotePort)));
    entry.Set("state", Napi::Number::New(env, static_cast<double>(row.dwState)));
    result.Set(index++, entry);
  }
  return result;
}

// ---------------------------------------------------------------------------
// processIdsByName()
// ---------------------------------------------------------------------------

static Napi::Value ProcessIdsByName(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "processIdsByName(name) expects a string")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  // tlhelp32.h has no ...A variants. The wide forms are used here and the
  // executable name is folded to lower case for the comparison.
  std::wstring wanted = toLowerWide(utf8ToWide(info[0].As<Napi::String>().Utf8Value()));

  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    Napi::Error::New(env, "CreateToolhelp32Snapshot failed").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Array result = Napi::Array::New(env);
  uint32_t index = 0;
  PROCESSENTRY32W entry = {};
  entry.dwSize = sizeof(entry);
  if (Process32FirstW(snapshot, &entry)) {
    do {
      if (toLowerWide(entry.szExeFile) == wanted) {
        result.Set(index++, Napi::Number::New(env, static_cast<double>(entry.th32ProcessID)));
      }
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);
  return result;
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isAvailable", Napi::Function::New(env, IsAvailable));
  exports.Set("loadError", Napi::Function::New(env, LoadError));
  exports.Set("listDevices", Napi::Function::New(env, ListDevices));
  exports.Set("startCapture", Napi::Function::New(env, StartCapture));
  exports.Set("stopCapture", Napi::Function::New(env, StopCapture));
  exports.Set("tcpConnectionsForPid", Napi::Function::New(env, TcpConnectionsForPid));
  exports.Set("processIdsByName", Napi::Function::New(env, ProcessIdsByName));
  return exports;
}

#else  // not _WIN32

// Midir captures on Windows only. The addon still builds elsewhere so the test
// suite and the type checker run on any platform.
static Napi::Object Init(Napi::Env env, Napi::Object exports) { return exports; }

#endif

NODE_API_MODULE(da_pcap, Init)
