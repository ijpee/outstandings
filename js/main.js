/**
 * Main Controller
 * Handles SMS selection and section toggling between Kamar, Hero, and Edge
 */

document.addEventListener('DOMContentLoaded', function () {
    console.log('Main controller initialized');

    // Get SMS selector dropdown
    const smsSelect = document.getElementById('smsSelect');

    // Get sections
    const kamarSection = document.getElementById('kamarSection');
    const heroSection = document.getElementById('heroSection');
    const edgeSection = document.getElementById('edgeSection');

    // Add event listener for SMS selection
    smsSelect?.addEventListener('change', function () {
        if (this.value === 'kamar') {
            showKamarSection();
        } else if (this.value === 'hero') {
            showHeroSection();
        } else if (this.value === 'edge') {
            showEdgeSection();
        }
    });

    // Functions to show/hide sections
    function showKamarSection() {
        if (kamarSection && heroSection && edgeSection) {
            kamarSection.style.display = 'block';
            heroSection.style.display = 'none';
            edgeSection.style.display = 'none';
            console.log('Switched to Kamar SMS');
        }
    }

    function showHeroSection() {
        if (kamarSection && heroSection && edgeSection) {
            kamarSection.style.display = 'none';
            heroSection.style.display = 'block';
            edgeSection.style.display = 'none';
            console.log('Switched to Hero SMS');
        }
    }

    function showEdgeSection() {
        if (kamarSection && heroSection && edgeSection) {
            kamarSection.style.display = 'none';
            heroSection.style.display = 'none';
            edgeSection.style.display = 'block';
            console.log('Switched to Edge SMS');
        }
    }

    // Initialize with Kamar selected by default
    showKamarSection();
});

