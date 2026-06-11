package sample

import (
	"fmt"
	"os"
	h "net/http"
	. "strings"
)

// Exported function (uppercase)
func HandleRequest(w h.ResponseWriter, r *h.Request) {
	fmt.Fprintln(w, "hello")
}

// Unexported function (lowercase)
func helperFunc() string {
	return "helper"
}

// Exported struct (uppercase)
type Server struct {
	Host string
	Port int
}

// Unexported struct (lowercase)
type config struct {
	debug bool
}

// Exported interface (uppercase)
type Handler interface {
	Handle(req *h.Request) error
	Close() error
}

// Method on Server (exported name)
func (s *Server) Start() error {
	return nil
}

// Method on Server (unexported name)
func (s *Server) listen() error {
	return nil
}

// Exported constant
const MaxRetries = 3

// Unexported constant
const defaultTimeout = 30

// Exported variable
var Version = "1.0.0"

// Unexported variable
var logger = os.Stderr

// Type alias (exported)
type RequestID string

// Embedded interface type (unexported)
type validator interface {
	Validate() bool
}

// Package init function
func init() {
	logger = os.Stderr
}
