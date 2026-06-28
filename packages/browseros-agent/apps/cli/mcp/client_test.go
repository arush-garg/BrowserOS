package mcp

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHealthUsesBrowserOSHealthEndpoint(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.URL.Path != "/health" {
			http.NotFound(w, r)
			return
		}
		fmt.Fprint(w, `{"status":"ok","cdpConnected":true}`)
	}))
	t.Cleanup(server.Close)

	data, err := NewClient(server.URL, "test", time.Second).Health()
	if err != nil {
		t.Fatalf("Health() error = %v", err)
	}
	if data["status"] != "ok" {
		t.Fatalf("Health() status = %v, want ok", data["status"])
	}
	assertPaths(t, paths, []string{"/health"})
}

func TestHealthFallsBackToClawSystemHealthEndpoint(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case "/health":
			http.NotFound(w, r)
		case "/system/health":
			fmt.Fprint(w, `{"status":"ok"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	data, err := NewClient(server.URL, "test", time.Second).Health()
	if err != nil {
		t.Fatalf("Health() error = %v", err)
	}
	if data["status"] != "ok" {
		t.Fatalf("Health() status = %v, want ok", data["status"])
	}
	assertPaths(t, paths, []string{"/health", "/system/health"})
}

func TestHealthDoesNotFallbackOnBrowserOSHealthFailure(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.URL.Path == "/health" {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)

	_, err := NewClient(server.URL, "test", time.Second).Health()
	if err == nil {
		t.Fatal("Health() error = nil, want HTTP 500")
	}
	if !strings.Contains(err.Error(), "HTTP 500") {
		t.Fatalf("Health() error = %q, want HTTP 500", err)
	}
	assertPaths(t, paths, []string{"/health"})
}

func assertPaths(t *testing.T, got, want []string) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("paths = %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("paths = %v, want %v", got, want)
		}
	}
}
