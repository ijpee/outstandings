/**
 * Main Controller
 * Handles SMS selection and section toggling between Kamar and Hero
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Main controller initialized');
    
    // Get SMS selector dropdown
    const smsSelect = document.getElementById('smsSelect');
    
    // Get sections
    const kamarSection = document.getElementById('kamarSection');
    const heroSection = document.getElementById('heroSection');
    
    // Add event listener for SMS selection
    smsSelect?.addEventListener('change', function() {
        if (this.value === 'kamar') {
            showKamarSection();
        } else if (this.value === 'hero') {
            showHeroSection();
        }
    });
    
    // Functions to show/hide sections
    function showKamarSection() {
        if (kamarSection && heroSection) {
            kamarSection.style.display = 'block';
            heroSection.style.display = 'none';
            console.log('Switched to Kamar SMS');
        }
    }
    
    function showHeroSection() {
        if (kamarSection && heroSection) {
            kamarSection.style.display = 'none';
            heroSection.style.display = 'block';
            console.log('Switched to Hero SMS');
        }
    }
    
    // Initialize with Kamar selected by default
    showKamarSection();
});
